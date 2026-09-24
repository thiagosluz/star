# EventFlow

Plataforma SaaS multi-tenant para gestão de **eventos acadêmicos, corporativos e
comunitários** — da inscrição ao certificado, passando por submissão de trabalhos,
avaliação por pares e gamificação.

> **Estado:** FASES 1 a 17, 21, 22, 23, 24, 25, 29 a 42 concluídas (F15, F21, F22, F29–F42 entregues; a F43+ é a próxima) · **2202 testes** unitários/integração · **146 testes E2E**
> · ESLint e `tsc` sem erros · isolamento multi-tenant provado contra o banco real
> (inclusive sob PgBouncer em modo transação) · métricas em `/api/metrics`, `audit_logs`
> particionada por mês · **quotas de plano aplicadas** (eventos, membros da equipe e
> **armazenamento**), com **ciclo de vida do membro** (trocar papéis e remover),
> **página pública editável** pela instituição com patrocínio, autoria, **biblioteca de
> mídia** com reaproveitamento, **janela de exibição** agendada no fuso do evento,
> **portal do palestrante** com convite (que aparece na área do próprio palestrante), materiais
> e certificado · **inscrição no EVENTO** que já inclui as atividades abertas, com
> programação editável (rótulos em português) · **credenciamento por crachá** (um crachá por
> pessoa, contexto da leitura, folha A4 e crachá na tela) · **central do participante**
> (diretório de todos os eventos, ficha 360, recados com caixa de entrada e panorama da
> instituição) · **resiliência de balcão e palco** (credenciamento offline-first em IndexedDB,
> modos estritos contra bipes duplos, edição imediata de anúncio no telão e controles de roleta)
> · **rotinas automáticas com painel de operação** (`/superadmin/rotinas`: histórico, saúde e
> "executar agora"), **inspeção antivírus** dos arquivos enviados (com o padrão em não
> inspecionar), **lote de certificados em ZIP** por evento e **aviso de decisão** ao proponente
> da chamada · **crachá em etiqueta adesiva** (PDF com a grade da folha em milímetros) e em
> **impressora térmica** (ZPL II, com dpi e medida do rolo) e **confirmação de vaga por ITEM**
> (cada exigência com o próprio estado, e a vaga confirmada quando as obrigatórias acabam)
> · **quadro de demandas internas do evento** (Kanban com colunas configuráveis, equipes com
> líder, prazo no fuso do evento, comentários com menção, avisos por e-mail e caixa de entrada,
> e o cartão movido por arrastar **ou** por formulário — o quadro funciona sem JavaScript)
> · **rubrica de avaliação com número livre de critérios** (até 12, na trilha e na chamada, com a
> chave derivada do rótulo e a FORMA congelada a partir do primeiro parecer — a régua da nota não
> muda debaixo de quem já avaliou)
> · **editor visual do certificado** (arte de fundo da instituição, texto montado com variáveis,
> posicionamento por arrastar **ou** por milímetro digitado — funciona sem JavaScript —, cinco
> modelos prontos para personalizar e o desenho **congelado** em cada certificado emitido)

---

## Índice

1. [O que a plataforma faz](#1-o-que-a-plataforma-faz)
2. [Stack](#2-stack)
3. [Requisitos](#3-requisitos)
4. [Instalação inicial (passo a passo)](#4-instalação-inicial-passo-a-passo)
5. [Stack completa em containers (com worker)](#5-stack-completa-em-containers-com-worker)
6. [Dados de demonstração (seed)](#6-dados-de-demonstração-seed)
7. [Usuários padrão do seed](#7-usuários-padrão-do-seed)
8. [Variáveis de ambiente](#8-variáveis-de-ambiente)
9. [Scripts disponíveis](#9-scripts-disponíveis)
10. [Testes](#10-testes)
11. [Documentação centralizada](#11-documentação-centralizada)
12. [Arquitetura em uma página](#12-arquitetura-em-uma-página)
13. [Segurança e isolamento multi-tenant](#13-segurança-e-isolamento-multi-tenant)
14. [Solução de problemas](#14-solução-de-problemas)
15. [Limitações conhecidas](#15-limitações-conhecidas)

---

## 1. O que a plataforma faz

| Domínio | Capacidade |
|---|---|
| **Multi-tenancy + RBAC** | Uma base, várias instituições isoladas por Row-Level Security; 11 papéis e 58 permissões, com acúmulo de papéis e troca de contexto sem perder a sessão |
| **Eventos e inscrições** | Eventos, atividades, salas, vagas sem superlotação (mesmo sob concorrência), lista de espera FIFO, landing pages públicas personalizáveis e **inscrição aberta**: quem se inscreve passa a ser participante da instituição (vínculo suspenso ou removido continua bloqueado). A inscrição pode ser **no evento** — e ela já inclui as atividades **abertas** (palestra, mesa-redonda), que não pedem inscrição própria e ignoram lotação — ou **por atividade** (minicurso, oficina), que continua com vaga e fila. A programação é **editável e excluível** pelo organizador (excluir só o cadastro nunca usado; com inscritos ou presença, a mensagem manda cancelar), e os tipos e situações aparecem **em português** |
| **Salas e vagas** | A sala tem **ciclo de vida próprio** na tela do evento: criar, **editar** e **excluir** (a exclusão é recusada enquanto alguma atividade a usa, com a contagem — a FK é `ON DELETE SET NULL` e sem a guarda a sala sumiria da programação em silêncio). A **capacidade é opcional**: em branco significa **sem limite**, e quem limita é a lotação da atividade. Com capacidade declarada, a sala passa a ser o **teto das vagas**: a atividade que não couber é recusada ao salvar, e a **reserva de vaga** (a mesma instrução atômica que impede superlotação sob concorrência) para no limite da sala — uma atividade sem vagas declaradas numa sala de 40 confirma 40, não mais. Reduzir a capacidade abaixo das vagas configuradas ou dos inscritos é recusado com o número. A página pública anuncia o limite **efetivo**, dizendo quando a sala é quem limita |
| **Submissão e avaliação** | Chamada de trabalhos por trilha, upload de PDF direto ao storage, revisão cega, rubrica com nota ponderada, conflito de interesse e decisão do comitê. O autor cria o rascunho e **cai direto na página da submissão** (anexar e enviar), **edita** título, resumo e palavras-chave enquanto ela não foi enviada — as regras do envio (resumo mínimo, 3 a 8 palavras-chave distintas) valem já na criação, com contagem em tempo real no campo — e pode **excluir os próprios rascunhos**: submissões enviadas são registro da avaliação e não se apagam |
| **Chamadas de propostas** | A chamada deixou de ser uma só e de servir apenas ao artigo: cada **chamada** tem o próprio TIPO (artigo, palestrante, minicurso, oficina, mesa-redonda, pôster ou outra atividade), o próprio texto e a própria janela. A organização **cria, publica e despublica** pela tela do evento, escolhe **trilha** (opcional: palestrante e minicurso não têm eixo temático), **cegueira** e **rubrica própria** (que vence a da trilha) e o **limite de propostas por autor NA CHAMADA**. A proposta é uma submissão — mesmo motor de pareceres, quórum e decisão — com **campos por tipo** (carga horária, público-alvo, minibiografia, formato…) validados no domínio; fora da ciência a trilha deixa de ser obrigatória e a ausência de anexo **avisa** em vez de bloquear. O **formulário é público** (leitura sem login; envio com conta criada no caminho, e o vínculo de participante nasce da proposta), e o bloco **"Chamadas de propostas"** da página pública é posicionado pelo organizador, lendo prazo e estado calculados no servidor. O **protocolo de aceite** fecha o ciclo: a decisão é do comitê e **criar a atividade na programação** (com a carga horária declarada) e **convidar o proponente como palestrante** (convite por e-mail, token mostrado uma vez) são **escolhas do organizador** |
| **Gamificação** | XP com livro-razão idempotente, cartas colecionáveis com raridade e foil, missões, ofensiva, níveis e prestígio |
| **Certificação** | PDF/SVG assinado (HMAC-SHA256), hash de integridade, QR Code e **validação pública sem login** |
| **Credenciamento** | Check-in/check-out com carga horária real, por busca ou por leitor de QR Code |
| **Painel administrativo** | Eventos, salas, programação, trilhas, cartas, missões e certificados pela interface, com trilha de auditoria |
| **Sorteios** | Sorteio por evento, dia ou atividade, elegível apenas por **presença real**, com amostragem criptográfica, **suplentes**, **chance proporcional ao tempo de presença**, hash auditável, **prova de commit-reveal** (semente comprometida na criação e revelada na apuração), **registro de entrega do prêmio**, publicação opcional do resultado com nome mascarado, histórico paginado e prévia que acompanha o credenciamento ao vivo |
| **Operação de palco** | O sorteio no dia do evento: **desfazer** uma entrega marcada por engano exigindo o **motivo** (a posição continua sendo a ganhadora e a trilha guarda as duas pontas), **filtrar o histórico** por situação e período no fuso da instituição, **premiar N revisores** com o corte do ranking dito antes do clique, **endereço próprio** do resultado publicado (para projetar e compartilhar, com a prova da semente), **chave do cofre versionada** que gira sem invalidar compromisso publicado e **prévia ao vivo por SSE** — uma conexão por tela, com o polling mantido como caminho de volta declarado |
| **Palco e auditoria** | O sorteio no telão e a conferência pública: página de **palco** com o compromisso da semente visível ANTES da apuração, contagem de elegíveis ao vivo e revelação automática (com efeitos próprios, sem dependência nova); **link copiável + QR Code** na tela de sorteios; e **auditoria** que publica a lista de elegíveis na ordem do sorteio, assina o hash dela no resultado e refaz as três contas (semente, lista e reprodução) **no navegador de quem lê** — além da receita para conferir fora do site |
| **Sorteio ao vivo, em rodadas** | O sorteio deixou de ser um momento só: cada **rodada** tem o próprio compromisso de semente, o próprio **prêmio** (título e descrição) e o próprio **patrocinador** — anunciados no telão e no resultado, e **fora** do documento assinado (corrigir o texto do prêmio não invalida resultado publicado). **"Criar para o palco"** cria o sorteio sem apurar, para o telão existir antes do anúncio; **"Preparar próxima rodada"** publica um compromisso novo (revelar a semente de uma rodada não entrega as seguintes) e **"Sortear a rodada N"** apura. As **posições continuam** entre as rodadas (a entrega do prêmio é por posição) e **quem ganhou não concorre de novo** — no domínio, com o motivo dito na tela. O telão **rola uma roleta** com os nomes reais da lista publicada e para no ganhador; a auditoria e o resultado público passaram a ser **por rodada** |
| **Credenciamento por crachá** | Um **crachá por pessoa** no evento (código opaco, único, sem dado pessoal no QR), emitido individualmente ou **em massa** na área de crachás, impresso em **folha A4** (QR Code + código + nome, 8 por página) e disponível também no **crachá online** do próprio participante. O **modo monitor** lê o QR pela **câmera** do celular/computador (API nativa do navegador com decodificador local de reserva), por leitor USB ou digitando o código — escolhendo o CONTEXTO da leitura: **portaria** (chegada ao evento) ou **atividade** (frequência, com entrada, saída e minutos). Presença sem inscrição é registrada com aviso; a janela de credenciamento da atividade é respeitada; o crachá revogado identifica a pessoa e não vale; e quem esquece de registrar a saída é fechado no **fim da atividade**, pelo worker ou pelo painel |
| **Governança da plataforma** | Papel `SUPERADMIN` em escopo próprio (`PLATFORM`), provisionamento atômico de instituições, métricas consolidadas, suspensão com corte imediato de tráfego e **diretório público** de instituições em `/organizacoes` |
| **Central do participante** | A visão da **PESSOA**, que antes só existia por evento: **diretório** de todos os participantes da instituição (união de vínculo e inscrição) com busca, filtro por evento/certificado/presença e paginação; **ficha 360** com os eventos que a pessoa viveu, frequência e minutos, certificados, cartas, XP e toda a comunicação recebida; **recado** por e-mail **e** mensagem na **caixa de entrada** do participante (com marcação de lida por posse); **panorama** da instituição com taxa de comparecimento, minutos, certificados, cartas, XP e **série por evento**, recortada por período no **fuso da instituição**; e **exportação em CSV** com escape contra fórmula, teto de linhas e registro na trilha. A abertura da ficha entra na auditoria (`READ`) e o e-mail aparece **mascarado** na lista |
| **Identidade visual** | Sistema de design com tokens do `DESIGN.md` (superfícies, marca, estados, raridade), tipografia própria (Plus Jakarta Sans + Inter), **20 primitivos** em `@/components/ui`, shell de navegação agrupado por intenção, guia de estilo vivo em `/superadmin/design` e trava de teste que impede cor crua em código novo (dívida zerada na 11B: **nenhuma** cor crua ou tamanho arbitrário no código de interface) |
| **Operação e segurança** | Rate limit do login contado no **Redis** (vale entre instâncias), métricas no formato **Prometheus** em `/api/metrics` com token, log estruturado com redação de senha/e-mail, RLS criada pela própria migração, `audit_logs` **particionada por mês** e pool de conexões com **PgBouncer** em modo transação |
| **Rotinas automáticas** | As cinco rotinas da plataforma — **prazos de parecer**, **presenças em aberto**, **confirmação de vaga**, **inspeção de arquivos** e **partições da auditoria** — abrem e fecham um registro em `job_runs`: o painel `/superadmin/rotinas` mostra **cadência em português, saúde, última passada, resultado e o motivo da falha**, com histórico das 40 execuções mais recentes e o botão **"Executar agora"** (que enfileira para o worker). A mesma linha que registra é a **exclusão mútua** (índice único parcial, e não advisory lock: o PgBouncer em modo transação não preserva lock de sessão) e execução órfã é encerrada como falha em meia hora, para a rotina nunca travar para sempre |
| **Segurança dos arquivos** | Todo arquivo enviado por gente de fora (submissão e material de palestrante) pode passar por **inspeção antivírus** antes de ser servido: `INFECTED` **nunca** é servido (nem com a inspeção desligada depois), `PENDING` só é bloqueado enquanto a inspeção está ligada, e falha do antivírus **não é veredito** (o arquivo continua pendente). O driver padrão é **não inspecionar** — os arquivos nascem `SKIPPED`, são servidos e a tela diz que não houve inspeção. ClamAV sobe em perfil próprio (`--profile av`) e a ameaça fica na trilha |
| **Lote e avisos** | Os **certificados de um evento** baixam em um **ZIP** montado em fluxo (um PDF por vez, sem carregar o lote em memória), com o nome `<código>-<nome>.pdf`, contagem dos que ficaram de fora e registro na trilha (`EXPORT`); e o **proponente de uma chamada é avisado da decisão** (aceita, recusada ou ajustes solicitados) por **e-mail e na caixa de entrada**, com o parecer do comitê e uma chave por decisão — pedir ajustes e depois aceitar são dois fatos, dois avisos |
| **Planos e quotas** | Planos FREE/STARTER/PROFESSIONAL/ENTERPRISE com quotas de eventos, **membros da equipe** e **armazenamento**; troca de plano e edição de quotas pelo painel de governança (com aviso quando a nova quota fica abaixo do uso); as **três** quotas **recusam de verdade** — e o público de evento, que ganha acesso automático na inscrição pública, **não** consome a quota de membros |
| **Ciclo de vida do membro** | A tela de equipe passou a **operar** o vínculo: trocar os papéis de um membro (checkboxes com os papéis de instituição, gravados de uma vez) e **remover** — remoção **lógica** (`REMOVED`), com **todas** as concessões revogadas em qualquer escopo e a quota liberada; o histórico de quem fez o quê continua legível. Ninguém remove o próprio acesso, e o **último proprietário ativo** não pode ser removido nem rebaixado — a recusa vem escrita. O diálogo **avisa** quando a pessoa tem inscrições, porque o vínculo é único por (instituição, pessoa) |
| **Gamificação (conquistas)** | Cartas por gatilho, incluindo os dois de **marco** que só existiam no catálogo: `EVENT_ATTENDANCE_FULL` (presença em todas as atividades exigidas, concedida no check-out que fecha a última) e `REVIEWER_TOP` (revisor destaque premiado por ranking de pareceres, com piso lido da própria carta) |
| **Página pública e patrocínio** | A instituição **monta a própria vitrine**: página que nasce como rascunho e só vai ao ar quando publicada, 13 tipos de bloco com conteúdo validado por tipo no domínio (destaque, texto, agenda, palestrantes, trilhas, chamadas de propostas, patrocinadores, perguntas frequentes, galeria, contagem, local, chamada de inscrição e HTML exibido como texto), ordem ajustável, blocos ocultáveis, composição sugerida, **tema visual** (cores, tipografia, densidade, cabeçalho e animação) e **capa e logotipo por upload** direto ao storage — com allowlist de tipo e verificação da assinatura real do arquivo (SVG recusado por poder conter script). **Patrocínio** com cotas, ordem de exibição, limite de vagas aplicado na transação e documento fiscal mascarado |
| **Vitrine do patrocínio** | Cada cota define **a cor e o tamanho da logo** na página pública (Pequena · Média · Grande · Destaque), com **prévia do cartão** no próprio formulário e amostras de cor como atalho — o campo aceita hexadecimal e `oklch()` e funciona sem JavaScript. A página desenha **uma faixa por cota**, com marcador na cor, descrição e **cartões tingidos**; a cor entra como **tom** (a cor cheia fica no marcador, nunca atrás de texto) e o nome é dimensionado pela escala quando o patrocinador ainda não tem arquivo de logo |
| **Experiência do patrocinador** | O patrocinador ganha **área própria** — e é o **vínculo**, não o papel, que decide o que ele vê: por **convite com token** (guardado como hash, aceito pelo e-mail da conta) ou por **vínculo direto** de quem já tem conta. Lá dentro é **só leitura**: cota, benefícios, valor e vigência do contrato, os **QR codes do estande** e os contatos autorizados. O **QR** (código público de 8 caracteres, criado pela organização com XP por visita, carta opcional e prazo de autorização de 1 a 365 dias) **sai como imagem pronta para imprimir** — na tela do organizador **e** na do patrocinador, com o endereço absoluto à vista e **download em PNG (para imprimir na hora) e SVG (para cartaz, sem serrilhar)** — credita **XP e/ou carta uma vez por pessoa** e, na mesma leitura, a pessoa escolhe **autorizar** ou **registrar sem compartilhar**: **a recompensa não depende da resposta** (consentimento não é pedágio, LGPD art. 8º §3º). Com autorização, o patrocinador recebe **nome e e-mail, e nada mais**, com o texto lido gravado, prazo e **revogação em um clique** na tela "Meus compartilhamentos" do participante |
| **Autoria de trabalho** | Coautores editáveis antes do envio, com **ordem de crédito** (a ordem da tela é a ordem de citação), autor correspondente único, ORCID validado e vínculo automático de conta dentro da instituição — o nome de quem tem conta vem do perfil |
| **Operação do conteúdo** | **Pré-visualização** do rascunho antes de publicar (o mesmo componente da página pública, em rota autenticada com selo de estado), **publicação agendada** que entra no ar sozinha na data marcada, **histórico de versões** com restauração (20 por página, sem gravar versão idêntica), **imagem enviada direto do computador** também para a galeria, e **cópia de patrocinador** de outra edição com cota casada pela categoria e cadastro oculto |
| **Mídia e agendamento** | **Biblioteca de mídia** da instituição (`media_assets`, com RLS): todo envio registra autor, tamanho, tipo, checksum e finalidade, a **mesma imagem** é reaproveitada em vez de duplicar o objeto e a exclusão **confere o uso** antes de apagar — recusando com a lista de onde a imagem aparece. **Janela de exibição**: a página entra no ar e **sai sozinha** na data de término (decidido na leitura, sem agendador), com estado próprio para "configurada, publicada e fora do prazo". As datas são digitadas e lidas no **fuso do evento** (o mesmo do rodapé da página), com conversão correta em horário de verão. O patrocinador **copiado** de outra edição guarda a origem e pode ser **sincronizado** — propagando só os dados da empresa e preservando cota, contrato e vigência |
| **Comunicação** | **E-mail transacional de verdade** (Resend) com fila, tentativas e um **outbox** (`email_messages`) que guarda o que foi enviado antes de sair: assunto, HTML e texto, destinatário, situação, driver e o motivo da falha. **Onze** mensagens em templates puros — confirmação de e-mail, redefinição de senha, **convite de equipe**, avaliação atribuída, prazo de parecer (aviso e vencimento), carta conquistada, certificado emitido, **recado ao participante**, **proposta recebida** e **convite de palestrante** (com o link do portal e validade de 14 dias). A instituição **convida a própria equipe** pela tela de equipe (o convite não ocupa vaga no plano; o vínculo nasce no aceite, onde a quota é conferida), acompanha tudo em **Comunicação** e a pessoa confirma o próprio endereço numa página própria. **O padrão é não enviar**: sem `EMAIL_DRIVER=resend` declarado, o e-mail é registrado e não sai da máquina |
| **Portal do palestrante** | O palestrante é uma **pessoa da instituição** (não uma linha da atividade): a organização cadastra nome, e-mail, instituição e minibiografia, **vincula a uma ou mais atividades** com o papel de cada uma ("Keynote" na abertura, "Instrutor" no minicurso) e recebe um **código de convite** (guardado apenas como hash) para entregar a ele. Com o código — ou pelo painel, quando o e-mail confere — o palestrante **assume o perfil** e passa a editar bio, foto, redes e afiliação, publicar **materiais de apoio** (slides, apostilas, links) com visibilidade por material (**aberto**, **só inscritos** ou **rascunho**) e escrever a ementa detalhada da própria atividade. O convite pendente **aparece na área do palestrante** (e no menu, como "Convite de palestrante") assim que ele entra com a conta daquele e-mail — sem depender do link. A **vitrine pública** mostra foto, bio e atividades de cada um, com ficha individual; e a **ficha da atividade** destaca quem ministra e libera o download conforme a inscrição. O **certificado de palestrante** sai pelo próprio portal, somando apenas as atividades **efetivamente ministradas** — exige evento encerrado e credenciamento registrado no balcão |

---

## 2. Stack

| Camada | Tecnologia |
|---|---|
| Aplicação | Next.js 16 (App Router, Server Components, Server Actions, Route Handlers) · React 19 |
| Arquitetura | Clean Architecture / DDD adaptado ao Next.js (domínio puro, aplicação, infraestrutura) |
| Banco | PostgreSQL 18 com **Row-Level Security** · Prisma 7 (driver adapter `pg`) |
| Cache e filas | Redis 8 · BullMQ (geração de certificados e entrega de e-mails) |
| Storage | MinIO (S3-compatível), buckets privados com URLs pré-assinadas |
| Interface | Tailwind CSS 4 · Shadcn/UI (primitivas) · Lucide · Canvas Confetti |
| Autenticação | Better Auth 1.7 + adapter Prisma |
| E-mail | Resend (API oficial) atrás de um driver com modo `log` para desenvolvimento e teste |
| Qualidade | Vitest · Testing Library · Playwright |
| Infra | Docker · Docker Compose multi-stage |

---

## 3. Requisitos

| Requisito | Versão | Observação |
|---|---|---|
| Node.js | **≥ 24** | `package.json` declara `engines.node` |
| npm | ≥ 10 | os comandos deste README usam `npm` (o projeto versiona `package-lock.json`) |
| Docker + Compose | Docker Desktop recente | precisa estar **em execução** |
| Portas livres | 3000, 5432, 6379, 9000, 9001 | configuráveis em `.env` |

---

## 4. Instalação inicial (passo a passo)

```bash
# 1. Variáveis de ambiente
cp .env.example .env
#    O .env.example já traz valores funcionais para desenvolvimento local.
#    Leia a seção 8 antes de subir para qualquer ambiente compartilhado.

# 2. Dependências
npm install

# 3. Infraestrutura (PostgreSQL, Redis, MinIO + provisionamento de buckets)
docker compose up -d
docker compose ps          # aguarde os três serviços como "healthy"

# 4. Banco: migrações, RLS, verificação do contrato, prova de isolamento e seed
npm run db:setup

# 5. Aplicação
npm run dev                # http://localhost:3000
```

O que o passo 4 faz, em ordem:

| Comando interno | O que garante |
|---|---|
| `db:migrate` | aplica as migrações e regenera o cliente Prisma |
| `db:rls` | (re)aplica as policies de Row-Level Security — **rode sempre que criar tabela com `tenantId`** (desde a FASE 13 elas também vivem em migração: um banco novo nasce íntegro com `db:migrate:deploy`) |
| `db:verify` | falha se alguma tabela de tenant (ou partição) estiver sem RLS/policy ou se a role de runtime puder ignorar a RLS |
| `db:verify:isolation` | executa **9 ataques** reais de isolamento entre instituições |
| `db:seed` | popula os dados de demonstração (seção 6) |

**URLs depois de subir:**

```text
Aplicação .......... http://localhost:3000
Landing pages ...... http://localhost:3000/t/ufba-demo/eventos
Console do MinIO ... http://localhost:9001   (eventflow_minio / eventflow_minio_secret)
Subdomínios ........ http://ufba-demo.lvh.me:3000/eventos   (ROOT_DOMAIN=lvh.me)
```

---

## 5. Stack completa em containers (com worker)

Na FASE 6 a geração de certificados passou a rodar em um **worker BullMQ** separado.
Para exercitar esse caminho (e rodar os E2E), suba a stack completa:

```bash
docker compose --profile app up -d --build
docker compose --profile app ps
docker logs eventflow-worker --tail 30     # fila "certificates"

# Opcional (FASE 13): pool de conexões PgBouncer, porta 6432
docker compose --profile pooler up -d pooler
npm run db:verify:pooling                  # prova que o contexto de tenant não vaza
```

> **Atenção:** se o `--build` falhar, o Compose **mantém o container anterior no ar**.
> Um `docker compose ps` mostrando "healthy" não prova que a imagem é a nova. Confira
> com `docker images | grep eventflow/web` antes de concluir que o código subiu.

---

## 6. Dados de demonstração (seed)

`npm run db:seed` recria **dois** tenants de demonstração de forma idempotente
(remove e recria os dados identificados pelos slugs/e-mails do seed).

### Instituições

| Slug | Nome | Fuso |
|---|---|---|
| `ufba-demo` | Universidade Federal da Bahia | America/Bahia |
| `fiocruz-demo` | Fundação Oswaldo Cruz | America/Sao_Paulo |

### Conteúdo criado

```text
Eventos ......... 2 (Congresso de Tecnologia e Educação 2026 · Simpósio de Saúde Coletiva 2026)
Salas ........... 2 no congresso (Auditório 300 lugares · Sala de Oficinas 40)
Atividades ...... 4 (no congresso: abertura e minicurso Rust — 30 vagas + lista de
                  espera — e mesa-redonda; no simpósio: palestra de epidemiologia).
                  Abertura e a palestra do simpósio são ABERTAS a todos os inscritos
                  do evento (sem inscrição individual); mesa-redonda e minicurso
                  seguem com inscrição por atividade)
Chamada ......... 1 trilha "Tecnologia Educacional": rubrica de 4 critérios (pesos 3/3/1/1),
                  2 pareceres exigidos, aceite ≥ 70, rejeição < 45, revisão cega.
                  E 2 CHAMADAS DE PROPOSTAS publicadas (palestrantes, sem trilha, e
                  minicursos, com rubrica própria de 5 critérios de oficina), com 1
                  proposta de minicurso recebida (protocolo impresso no seed)
Revisores ....... 2 perfis: Bruno declara a UFBA (gera conflito no painel do comitê)
                  e Diego é de outra instituição (candidato elegível)
Gamificação ..... 7 cartas (comum → mítica; duas com tiragem limitada de 50 e 10),
                  6 missões e 9 fatos de XP — Ana com 700 XP/nível 5/2 cartas,
                  Bruno com 920 XP/nível 5/3 cartas (1 foil)
Certificação .... presença medida de 240 min (Bruno) + 1 trabalho aceito (Ana)
                  e 2 certificados emitidos, com código e PDF válidos.
                  E 1 MODELO VISUAL de certificado para o minicurso, criado a partir
                  do "Clássico institucional" (o certificado do Bruno nasce com ele;
                  a arte de fundo é da instituição e o editor está em
                  /t/ufba-demo/administracao/certificados/modelos)
Página pública .. 6 blocos publicados no congresso (texto, trilhas, perguntas
                  frequentes, chamada de inscrição, chamadas de propostas e
                  patrocinadores), tema próprio e 2 cotas (Ouro e Prata) com 3
                  patrocinadores — cores e tamanhos diferentes (FASE 41)
Conteúdo ........ 11 versões no histórico da página do congresso (restauráveis no
                  editor) e a página do simpósio com JANELA completa — entra no ar
                  em 7 dias e sai sozinha em 21 (datas no fuso America/Bahia)
Mídia ........... acervo da instituição com as imagens de capa, logotipos e galeria
                  registradas (autor, tamanho, checksum e uso por imagem)
Palestrantes .... Bruno como palestrante do minicurso de Rust (perfil, vínculo com a
                  atividade, conta vinculada e 1 material público de apoio)
Patrocinador .... 1 QR de estande no patrocinador Ouro (80 XP por visita, autorização de
                  90 dias) — o endereço público sai no fim do seed (FASE 42)
```

Os **códigos de validação** dos certificados são aleatórios a cada execução e são
impressos no fim do seed:

```text
Certificação (FASE 6):
  Bruno (minicurso): CERT-XXXXXXXX (emitido) · http://localhost:3000/validar/CERT-XXXXXXXX
  Ana (autoria):     CERT-YYYYYYYY (emitido) · http://localhost:3000/validar/CERT-YYYYYYYY
```

Abra a URL em uma **janela anônima**: a validação pública funciona sem login.

### Percursos de demonstração

```text
Painel público ..... /t/ufba-demo/eventos
Landing do evento .. /t/ufba-demo/eventos/congresso-2026
Inscrição no evento  /t/ufba-demo/eventos/congresso-2026/inscricao   (inclui as atividades abertas)
Inscrição .......... /t/ufba-demo/eventos/congresso-2026/atividades/minicurso-rust
Submissões ......... /t/ufba-demo/submissoes        (autor)
Revisões ........... /t/ufba-demo/revisoes          (revisor)
Comitê ............. /t/ufba-demo/comite            (presidente do comitê)
Conquistas ......... /t/ufba-demo/conquistas        (XP, missões, ranking)
Cartas ............. /t/ufba-demo/cartas            (álbum)
Certificados ....... /t/ufba-demo/certificados
Credenciamento ..... /t/ufba-demo/credenciamento    (equipe: busca e leitor de QR)
Painel admin ....... /t/ufba-demo/administracao     (gestão, quotas de uso + trilha de auditoria)
Equipe ............. /t/ufba-demo/administracao/equipe       (convidar, trocar papéis, remover)
Comunicação ........ /t/ufba-demo/administracao/comunicacao  (caixa de saída do e-mail)
Convite de equipe .. /t/ufba-demo/convite?codigo=<TOKEN>     (aceite; público, autenticado)
Confirmação de e-mail /verificacao                            (resultado do link)
Sorteios ........... /t/ufba-demo/administracao/eventos/<id>/sorteios
Editor da página ... /t/ufba-demo/administracao/eventos/<id>/pagina
Pré-visualização ... /t/ufba-demo/administracao/eventos/<id>/pagina/previa
Patrocínio ......... /t/ufba-demo/administracao/eventos/<id>/patrocinadores
Chamadas de propostas /t/ufba-demo/administracao/eventos/<id>/chamadas   (criar, publicar, rubrica)
Chamada pública .... /t/ufba-demo/eventos/congresso-2026/chamada/chamada-palestrantes
Validação pública .. /validar/<código>              (sem login)
Diretório público .. /organizacoes                  (sem login: todas as instituições)
Área do patrocinador /t/ufba-demo/patrocinador      (só leitura; por vínculo com o patrocinador)
Leitura do QR ...... /t/ufba-demo/patrocinio/<código>   (sem login; o código sai no seed)
Meus compartilhamentos /t/ufba-demo/meus-compartilhamentos  (participante revoga o contato)
Governança ......... /superadmin                    (só SuperAdmin; 404 para os demais)
Instituição suspensa /instituicao-bloqueada?slug=<slug>
```

---

## 7. Usuários padrão do seed

> ### ✅ Quer entrar e testar agora? Use as **contas de teste**
>
> ```bash
> npm run db:seed:dev     # uma conta por perfil, todas com senha EventFlow@2026
> ```
>
> Tabela completa (perfil → o que testar → onde clicar) em
> [`docs/contas-de-teste.md`](docs/contas-de-teste.md). O script **se recusa a rodar
> em produção**.
>
> As contas abaixo são as do seed principal, que servem para exercitar RBAC no banco —
> e que **não têm senha**, de propósito.

| Conta | Papéis | Vínculo |
|---|---|---|
| `ana@example.test` | ADMIN em `ufba-demo` · CHAIR + PARTICIPANT em `fiocruz-demo` | dois tenants ativos |
| `bruno@example.test` | ORGANIZER + REVIEWER + STAFF (escopo de evento) em `ufba-demo` | ativo |
| `carla@example.test` | PARTICIPANT em `ufba-demo` | **convite PENDENTE** |
| `diego@example.test` | REVIEWER em `ufba-demo` | ativo |

> ### ⚠️ Essas contas **não têm senha**
>
> Elas existem para exercitar **RBAC, multi-tenancy e gamificação**, não para login
> por senha: uma conta só consegue autenticar se tiver uma linha em `account`
> (`providerId = 'credential'`), e o seed não cria nenhuma para elas. Tentar entrar com
> qualquer senha falha, e isso é intencional.
>
> **Para usar a interface com um usuário real:** crie uma conta em `/signup` e
> vincule-a à instituição de demonstração:
>
> ```bash
> # 1. crie a conta pela interface: http://localhost:3000/signup
> # 2. descubra o id do usuário e vincule + conceda papel (exemplo com psql via container)
> docker exec -it eventflow-postgres psql -U eventflow_admin -d eventflow -c \
>   "SELECT id, email FROM \"user\" WHERE email = 'seu.email@exemplo.test';"
> ```
>
> Com o `id` em mãos, use o Prisma Studio (`npm run db:studio`) para inserir a linha
> em `user_tenant_profiles` (`status = ACTIVE`) **com `tenantId` preenchido** e a
> linha correspondente em `role_assignments` (`role = 'ADMIN'`, `scope = 'TENANT'`).
> Também é possível reaproveitar `tests/e2e/helpers.ts`, que faz exatamente isso
> (`linkUser` + `grantRole`).
>
> **Observação sobre `carla@example.test`:** o vínculo com status `INVITED` **não
> concede contexto** — a plataforma é *fail-closed*: sem vínculo ativo, a
> instituição não aparece no seletor e o acesso é negado.

### Primeiro SuperAdmin (governança da plataforma)

O seed **não** cria um SuperAdmin, e isso é deliberado: a primeira concessão não pode
depender de alguém que já a tenha. Crie a conta em `/signup` e conceda o papel pela
conexão administrativa (a única que enxerga concessões de plataforma, que têm
`tenantId = NULL`):

```bash
docker exec -it eventflow-postgres psql -U eventflow_admin -d eventflow -c "
INSERT INTO role_assignments (id, \"tenantId\", \"userId\", role, scope, \"grantedAt\", \"updatedAt\", reason)
SELECT gen_random_uuid(), NULL, id, 'SUPERADMIN', 'PLATFORM', now(), now(), 'Concessão inicial'
FROM \"user\" WHERE email = 'seu.email@exemplo.test';"
```

A partir daí o painel `/superadmin/governanca` concede e revoga os demais — e
`/superadmin` responde **404** para quem não tem o papel.

---

## 8. Variáveis de ambiente

O `.env.example` é a fonte da verdade; abaixo estão as que realmente importam para
entender o comportamento do sistema.

### Banco de dados — **dois papéis, de propósito**

| Variável | Papel |
|---|---|
| `MIGRATE_DATABASE_URL` | role **admin/dona do schema** (`eventflow_admin`): usada por CLI, seed e Better Auth |
| `APP_DATABASE_URL` | role de **runtime** (`eventflow_app`, `NOSUPERUSER`, `NOBYPASSRLS`): é a conexão que sofre RLS |

Usar a mesma conexão para tudo faria a RLS perder sentido: o dono da tabela a ignora
sem `FORCE ROW LEVEL SECURITY`, e o runtime **nunca** pode ter esse privilégio.

### Segredos

| Variável | Observação |
|---|---|
| `BETTER_AUTH_SECRET` | obrigatória em qualquer ambiente real; o build falha com o valor padrão |
| `CERTIFICATE_SIGNING_KEY_ID` | identificador da chave de assinatura (permite rotação auditável) |
| `CERTIFICATE_HMAC_SECRET` | segredo HMAC dos certificados — **o web e o worker precisam do MESMO valor**, senão todo certificado parece adulterado |
| `RATE_LIMIT_ENABLED` | nos E2E precisa ser `false` (o contador agora vive no Redis, mas a suíte dispara dezenas de cadastros do mesmo IP) |
| `METRICS_TOKEN` | token do `/api/metrics`; **sem ele, em produção, o endpoint responde 404** (a rota não existe para quem sonda) |
| `DATABASE_URL_POOLED` / `PGBOUNCER_PORT` | endereço do pooler (`6432`) usado pela prova de pooling |
| `PARTITION_MONTHS_AHEAD` | quantos meses à frente o `db:partitions` mantém criados (padrão `2`) |
| `RESEND_API_KEY` | chave da API do Resend. **Não é usada enquanto o driver for `log`** |
| `EMAIL_DRIVER` | `resend` (envia de verdade) ou `log` (**grava e NÃO envia** — padrão em dev e nos testes). Sem a variável, só vira `resend` em produção com chave presente |
| `EMAIL_FROM` | remetente. **Sem domínio verificado no Resend**, precisa ser `onboarding@resend.dev` — e a entrega só alcança o endereço dono da conta |
| `EMAIL_REPLY_TO` | opcional; vazio = o destinatário responde ao próprio remetente |
| `REVIEW_REMINDER_HOURS` | antecedência do aviso "seu parecer está vencendo" (padrão `48`) |

### Serviços e portas

| Variável | Padrão |
|---|---|
| `APP_PORT` / `APP_URL` | `3000` / `http://localhost:3000` |
| `POSTGRES_PORT` | `5432` |
| `PGBOUNCER_PORT` | `6432` (perfil `pooler`, opcional) |
| `REDIS_URL` | `redis://localhost:6379` |
| `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` | `9000` / `9001` |
| `S3_ENDPOINT` / `S3_PUBLIC_ENDPOINT` | `http://localhost:9000` |
| `S3_BUCKET_SUBMISSIONS` / `_CERTIFICATES` / `_ASSETS` / `_AVATARS` | buckets privados |
| `ROOT_DOMAIN` / `NEXT_PUBLIC_ROOT_DOMAIN` | `lvh.me` (subdomínios por instituição) |
| `E2E_BASE_URL` | base usada pelos testes Playwright |

---

## 9. Scripts disponíveis

| Script | O que faz |
|---|---|
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção (**usa `cross-env NODE_ENV=production`** — não rode `next build` direto, veja a seção 14) |
| `npm run start` | serve o build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:setup` | `migrate` + `rls` + `verify` + `verify:isolation` + `seed` |
| `npm run db:setup:dev` | o de cima + contas de teste com senha (ver `docs/contas-de-teste.md`) |
| `npm run db:migrate` | migrações + regeneração do cliente Prisma |
| `npm run db:rls` | reaplica as policies de RLS (idempotente) |
| `npm run db:verify` | verifica o contrato de isolamento (tabelas, policies, roles) |
| `npm run db:verify:isolation` | 9 ataques de isolamento entre tenants |
| `npm run db:verify:pooling` | prova, contra o PgBouncer, que o contexto de tenant não vaza entre transações (exige `--profile pooler`) |
| `npm run db:partitions` | cria as partições mensais futuras de `audit_logs` e resgata linhas da partição `DEFAULT` |
| `npm run db:seed` | dados de demonstração |
| `npm run db:seed:dev` | **só em desenvolvimento**: uma conta por perfil, com senha padrão (recusa-se a rodar em produção) |
| `npm run db:studio` | Prisma Studio |
| `npm test` | Vitest (unit + integração) |
| `npm run test:e2e` | Playwright (contra o container em `http://localhost:3000`) |
| `npm run test:e2e:ui` / `:report` | modo interativo / relatório |
| `npm run infra:up` / `down` / `reset` / `logs` / `ps` | atalhos do Docker Compose |
| `npm run infra:buckets` | reprovisiona os buckets do MinIO |

---

## 10. Testes

```bash
npm test                  # 2202 testes (95 arquivos) — unit + integração com banco real
npm run test:e2e          # 146 testes E2E contra o container de produção
npm run typecheck         # 0 erros
npm run lint              # 0 erros / 0 warnings
npm run db:verify         # contrato de RLS íntegro (tabelas, partições e tabelas de plataforma
                          # sem acesso para a role de runtime)
npm run db:verify:isolation   # 9/9 ataques de isolamento barrados
npm run db:verify:pooling     # contexto por transação preservado sob PgBouncer
npm run db:partitions         # partições mensais de audit_logs em dia
```

- **Integração** roda contra o PostgreSQL e o MinIO **reais** (a RLS é a fronteira de
  segurança; testá-la com mock testaria o mock). Os testes de observabilidade usam o
  **Redis real** (TTL e expiração do rate limit) e leem o catálogo do PostgreSQL para
  provar onde cada linha de auditoria foi gravada.
- **E2E** exige a stack no ar (`docker compose --profile app up -d --build`) e cobre,
  entre outros: isolamento entre instituições, jornada de inscrição, avaliação por
  pares, gamificação, certificação, convite de equipe com aceite, comunicação (caixa de
  saída e verificação de e-mail), a jornada administrativa completa e o **fechamento
  do endpoint de métricas em produção** (404 sem token).
- `tests/unit/**` não toca banco; `tests/integration/**` exige a infraestrutura.

---

## 11. Documentação centralizada

> **Trabalhando com um agente de código?** Leia primeiro o [`AGENTS.md`](AGENTS.md):
> ele traz o protocolo de fases, a bateria de verificação, as convenções e as
> armadilhas conhecidas do projeto.

Toda a documentação técnica vive em `docs/`, uma fase por arquivo. Cada documento
traz **ADRs** (decisões com contexto e consequências), **lições aprendidas** (defeitos
reais encontrados por testes), **evidências de verificação** e **comandos**.

| Documento | Conteúdo | ADRs |
|---|---|---|
| [`docs/fase-01-infra-e-modelagem.md`](docs/fase-01-infra-e-modelagem.md) | Docker Compose, PostgreSQL 18, roles `admin`/`app`, RLS com `FORCE`, modelagem completa (34+ modelos), contrato de isolamento | ADR-001 … 008 |
| [`docs/fase-02-auth-rbac.md`](docs/fase-02-auth-rbac.md) | Better Auth, 11 papéis (58 permissões hoje, incluindo as de plataforma), escopos, acúmulo de papéis, troca de contexto por cookie assinado | ADR-009 … 013 |
| [`docs/fase-03-eventos-inscricoes.md`](docs/fase-03-eventos-inscricoes.md) | Ciclo de vida do evento, lotação sob concorrência, lista de espera FIFO, landing page modular com tema validado. A **revisão pós-entrega** (§19) entrega a **inscrição no evento** que materializa as atividades abertas (`EVENT_AUTO`), `requiresRegistration` como coluna com padrão derivado do tipo, **edição e exclusão** de atividade na programação e rótulos de tipo/situação em português. A **segunda revisão** (§20) entrega o ciclo de vida da **sala** (editar e excluir, com a exclusão recusada quando há atividade usando), a **capacidade opcional** (vazio = sem limite) e a sala como **teto das vagas** — inclusive na reserva de vaga, com o limite efetivo anunciado na página pública | ADR-014 … 018 · 124 a 126 · 134 a 136 |
| [`docs/fase-04-submissoes-peer-review.md`](docs/fase-04-submissoes-peer-review.md) | Chamada de trabalhos, upload direto ao storage, rubrica ponderada, conflito de interesse, revisão cega, decisão. A **revisão pós-entrega** (§18) faz a criação do rascunho cair direto na página da submissão e entrega a **exclusão de rascunho** (nunca do que já foi enviado) | ADR-019 … 024 · 121 e 122 |
| [`docs/fase-05-gamificacao.md`](docs/fase-05-gamificacao.md) | Motor de recompensas, XP idempotente, curva de níveis, prestígio, cartas, foil, missões, credenciamento | ADR-025 … 031 |
| [`docs/fase-06-certificacao.md`](docs/fase-06-certificacao.md) | Elegibilidade, carga horária real, conteúdo canônico, assinatura HMAC, PDF/SVG, QR, fila BullMQ, validação pública | ADR-032 … 038 |
| [`docs/fase-07-painel-admin-e2e.md`](docs/fase-07-painel-admin-e2e.md) | Painel administrativo, trilha de auditoria, validações de agenda ligadas, E2E completo e estado final do projeto | ADR-039 … 043 |
| [`docs/fase-08-motor-de-sorteios.md`](docs/fase-08-motor-de-sorteios.md) | Sorteios por evento/dia/atividade, elegibilidade por presença real, amostragem criptográfica, trava pessimista na apuração, hash auditável e RLS por introspecção | ADR-044 … 049 |
| [`docs/fase-09-diretorio-e-superadmin.md`](docs/fase-09-diretorio-e-superadmin.md) | Escopo `PLATFORM`, SuperAdmin, provisionamento atômico, suspensão com corte imediato de tráfego, métricas consolidadas e diretório público de instituições | ADR-050 … 059 |
| [`docs/fase-10-inscricao-publica.md`](docs/fase-10-inscricao-publica.md) | Inscrição aberta em evento público, vínculo automático de participante na mesma transação, bloqueio da instituição com precedência e aviso ao participante | ADR-060 … 063 |
| [`docs/contas-de-teste.md`](docs/contas-de-teste.md) | **Guia operacional:** uma conta por perfil com senha padrão, o que testar em cada uma, comportamento das contas de borda e como o script cria as credenciais | — |
| [`docs/fase-15-comunicacao.md`](docs/fase-15-comunicacao.md) | **Comunicação:** e-mail transacional pelo Resend atrás de um driver com o padrão em NÃO enviar, fila `emails` com 5 tentativas, **outbox** que guarda o que saiu, 8 templates em funções puras, **convite de equipe** com token hasheado e vínculo no aceite, avisos de avaliação/prazo/carta/certificado e verificação de e-mail sem bloquear o login | ADR-127 … 130 |
| [`docs/fase-21-ciclo-de-vida-do-membro-e-storage.md`](docs/fase-21-ciclo-de-vida-do-membro-e-storage.md) | **Ciclo de vida do membro e armazenamento:** trocar papéis e remover membro pela tela de equipe (remoção lógica, concessões revogadas, guardas de posse própria e de último proprietário) e a **quota de armazenamento aplicada** em todo envio — submissão, mídia e material de palestrante — medida sobre **tudo** o que a instituição guarda, bloqueando só o upload novo e **nunca** a emissão de certificado | ADR-131 … 133 |
| [`docs/design-system.md`](docs/design-system.md) | **Sistema de design:** tokens, tipografia, catálogo de primitivos, regras de navegação, receita de módulo novo e o que a trava reprova | — |
| [`docs/dividas-tecnicas.md`](docs/dividas-tecnicas.md) | **Levantamento consolidado:** 54 dívidas abertas (o levantamento original mais o que cada fase declarou), verificadas no código, por tema, com esforço e fases candidatas numeradas como as fases que serão entregues | — |
| [`docs/analise-competitiva-e-roadmap.md`](docs/analise-competitiva-e-roadmap.md) | **Análise competitiva & roadmap (setembro de 2026, anterior à FASE 40):** benchmarking com Even3 e Sympla, gaps de monetização/DOI/B2B e plano de evolução em 4 horizontes — os números e um dos gaps já mudaram; a leitura atualizada é a linha seguinte | — |
| [`docs/roadmap-de-produto.md`](docs/roadmap-de-produto.md) | **Roadmap de produto (depois da FASE 40):** onde o EventFlow está, o modelo de receita do mercado (Even3, Sympla, Eventbrite, Cvent/Whova, Fourwaves), matriz de capacidades, as 8 lacunas em ordem de valor e a sequência proposta de F41 em diante, com o anti-roadmap | — |
| [`docs/fase-25-portal-do-palestrante.md`](docs/fase-25-portal-do-palestrante.md) | Portal do palestrante: o palestrante passa a ser **pessoa da instituição** (`speaker_profiles`) com perfil e vínculo de conta por **convite hasheado**, **portal** com posse verificada no banco, **materiais** com visibilidade por visitante (401/403/404), **vitrine** com foto e bio, ficha individual e **certificado de palestrante** que exige evento encerrado e credenciamento. A **revisão pós-entrega** (§10) abriu as portas que faltavam: o menu voltou a mostrar os itens pessoais e o convite pendente virou entrada do portal | ADR-113 … 120 |
| [`docs/fase-24-midia-e-agendamento.md`](docs/fase-24-midia-e-agendamento.md) | Mídia e agendamento: **biblioteca de mídia** (tabela `media_assets` com RLS, reaproveitamento por checksum e exclusão que **confere o uso**), **sincronia** do patrocinador copiado a partir da origem, **janela de exibição** (`unpublishAt` decidido na leitura) e a data agendada interpretada no **fuso do evento** | ADR-107 … 112 |
| [`docs/fase-23-conteudo-e-midia.md`](docs/fase-23-conteudo-e-midia.md) | Operação do editor de página: **pré-visualização** do rascunho pelo mesmo componente da página pública, **upload de imagem na galeria**, **cópia de patrocinador** entre eventos (cota pela categoria, cadastro oculto), **histórico de versões** com restauração e **publicação agendada** decidida na leitura — sem agendador | ADR-100 … 106 |
| [`docs/fase-41-vitrine-do-patrocinio.md`](docs/fase-41-vitrine-do-patrocinio.md) | **Vitrine do patrocínio:** a cota passa a definir **cor** e **tamanho da logo** na página pública, com prévia do cartão no cadastro; a coluna de cor existia desde a FASE 17 e **não tinha leitor** — o defeito que abriu a fase; inclui a trilha que não mente sobre o que mudou e o E2E que **mede** a diferença de tamanho | ADR-227 … 229 |
| [`docs/fase-17-pagina-publica-e-patrocinio.md`](docs/fase-17-pagina-publica-e-patrocinio.md) | Página pública montada pelo organizador: editor de blocos validados por tipo, tema visual, capa e logotipo por upload direto ao storage, cadastro de cotas e patrocinadores com limite de vagas e documento fiscal mascarado, e edição de coautores com ordem de crédito — tudo sem uma única migração | ADR-092 … 099 |
| [`docs/fase-22-operacao-de-palco.md`](docs/fase-22-operacao-de-palco.md) | **Operação de palco:** desfazer a entrega do prêmio **com motivo na trilha**, filtro do histórico por situação e período no fuso da instituição, premiação de **N revisores**, **endereço próprio** do resultado publicado com a prova da semente, chave do cofre **versionada** (`RAFFLE_SEED_KEYS`, girar não invalida compromisso) e prévia ao vivo por **SSE** com polling de volta. Inclui a correção de privacidade do consentimento de nome público | ADR-137 … 139 |
| [docs/fase-29-palco-e-auditoria.md](docs/fase-29-palco-e-auditoria.md) | **Palco e auditoria do sorteio:** o **telão** público (compromisso da semente ANTES da apuração, contagem ao vivo por SSE e revelação automática com confetes próprios), **link + QR** do telão na tela de sorteios, a **lista publicada** (ordem, código opaco e minutos) gravada na apuração e assinada no resultado (payload v3) e a **auditoria** que refaz as contas no navegador de quem lê — com a receita para conferir fora do site | ADR-140 … 143 |
| [docs/fase-32-central-do-participante.md](docs/fase-32-central-do-participante.md) | **Central do participante e inteligência da instituição:** o **diretório** de todos os participantes (união de vínculo e inscrição, com busca, filtros e paginação), a **ficha 360** (eventos, frequência e minutos, certificados, cartas, XP e comunicação), o **recado** por e-mail **e** mensagem na caixa de entrada do participante, o **panorama** da instituição por período e por evento e a **exportação em CSV** — com abertura de ficha auditada (`READ`), e-mail mascarado na lista e a correção de uma recusa silenciosa na guarda das Server Actions | ADR-153 … 157 |
| [docs/fase-33-chamadas-de-propostas.md](docs/fase-33-chamadas-de-propostas.md) | **Chamadas de propostas:** a chamada virou entidade com TIPO próprio (artigo, palestrante, minicurso, oficina, mesa-redonda, pôster e outra atividade), janela, cegueira, **rubrica própria** (precedência CHAMADA → TRILHA → PADRÃO) e limite por autor por chamada; a proposta **é uma submissão** com campos por tipo, o **formulário é público** (conta criada no caminho e vínculo de participante nascendo da proposta) e o bloco **"Chamadas de propostas"** aparece onde o organizador o colocar; o **protocolo de aceite** registra a decisão pelo motor do comitê e deixa **criar a atividade** (com a carga declarada) e **convidar o palestrante** como escolhas do organizador — o convite por e-mail quita a dívida **E25** | ADR-158 … 169 |
| [docs/fase-31-credenciamento-e-frequencia.md](docs/fase-31-credenciamento-e-frequencia.md) | **Credenciamento e frequência por crachá:** o **crachá** passou a existir (um código opaco `CR-XXXX-XXXX` por pessoa no evento), com **área de emissão individual e em massa**, **folha A4 em PDF** com QR + código + nome e **crachá online** do participante; o **modo monitor** lê o QR pela **câmera** (API nativa + decodificador local), pelo leitor USB ou por digitação, escolhendo o CONTEXTO (portaria × atividade) — e **credenciamento ≠ frequência**: a chegada é um fato, a sessão na atividade é outro, com entrada, saída e minutos com teto no fim da atividade | ADR-148 … 152 |
| [docs/fase-30-sorteio-ao-vivo-em-rodadas.md](docs/fase-30-sorteio-ao-vivo-em-rodadas.md) | **Sorteio ao vivo, em rodadas:** cada apuração é um MOMENTO com o próprio compromisso de semente, prêmio, patrocinador e resultado assinado (payload v4); **"Criar para o palco"** faz o telão existir ANTES da apuração; a **roleta** passa os nomes reais da lista publicada e para no ganhador; quem ganhou uma rodada não concorre nas seguintes; auditoria e resultado público **por rodada** | ADR-144 … 147 |
| [docs/fase-34-confirmacao-de-vaga.md](docs/fase-34-confirmacao-de-vaga.md) | **Confirmação de vaga com prazo:** o organizador escolhe no cadastro da atividade se a vaga é **automática** ou **exige confirmação**, com prazo em dias, **o que é preciso** (pagamento, doação, item, outro) e **onde confirmar**; a inscrição nasce **RETENDO a vaga** e a pessoa é avisada por **e-mail e na plataforma**; quem confirma é a **equipe**, na fila de confirmações; vencido o prazo, a vaga é **liberada automaticamente**, o primeiro da lista de espera é promovido e **os dois** são avisados | ADR-170 … 178 |
| [`docs/fase-35-resiliencia-balcao-e-palco.md`](docs/fase-35-resiliencia-balcao-e-palco.md) | **Resiliência de balcão e palco:** credenciamento **offline-first em IndexedDB** com sincronização idempotente cronológica via `idempotencyKey` e `Attendance.qrNonce` (quita E40), **seletor estrito de sentidos** (`IN`, `TOGGLE`, `OUT`) no console do monitor imune a bipes duplos e rajada (quita E43), **edição desacoplada de anúncios** de rodada sem alterar o hash assinado com reatividade SSE no telão (quita E38) e **controles interativos de roleta no palco** com pausa/retomada, replay e atalhos de teclado (quita E39) | ADR-179 … 182 |
| [`docs/fase-36-operacao-e-seguranca.md`](docs/fase-36-operacao-e-seguranca.md) | **Operação das rotinas e segurança dos arquivos:** as cinco rotinas automáticas passaram a ter **histórico, saúde e "executar agora"** em `/superadmin/rotinas` (a linha em `job_runs` é o registro E a exclusão mútua, decidida por índice único parcial — o PgBouncer em modo transação não preserva lock de sessão), a manutenção das **partições da auditoria** saiu do cron do host e virou rotina do worker (quita B7), a **inspeção antivírus** dos arquivos enviados entrou com driver cujo padrão é NÃO inspecionar, portão nos dois caminhos que servem bytes de terceiro e trilha da ameaça (quita A3), o **lote de certificados em ZIP** é montado em fluxo por evento (com trilha `EXPORT`) e o **proponente passou a ser avisado da decisão** da chamada, nos dois canais e com o parecer do comitê (quita E47) | ADR-183 … 191 |
| [`docs/fase-37-crachas-e-checklist.md`](docs/fase-37-crachas-e-checklist.md) | **Crachá em etiqueta e impressora térmica · confirmação por item:** a área de crachás ganhou a **folha de etiqueta adesiva** em PDF (grade configurável em milímetros, padrão 3 × 8 de 63,5 × 33,9 mm centralizados em A4) e o arquivo **ZPL II** para impressora térmica (dpi, medida do rolo e ampliação do QR configuráveis, padrão 203 dpi · 100 × 50 mm), sem marca nem modelo no código e com recusa do que não cabe antes de gastar a folha (quita E41); e a **confirmação de vaga passou a ser por ITEM** — cada exigência vira uma linha da inscrição (`registration_confirmation_items`, snapshot criado na inscrição retida **e** na promoção da lista de espera), marcada uma a uma no balcão, com a vaga confirmada sozinha quando todas as obrigatórias acabam e pelo mesmo caminho da confirmação manual (quita E48) | ADR-192 … 199 |
| [`docs/fase-38-quadro-de-demandas.md`](docs/fase-38-quadro-de-demandas.md) | **Quadro de demandas internas do evento:** um Kanban por evento, com **colunas configuráveis** (nascendo com o padrão) e a **coluna** — e não o nome dela — decidindo a conclusão (`isDone` grava `completedAt`); **equipes do evento** com nome, **um líder** (índice único parcial) e membros; responsáveis, **início, prazo e concluído em** com o atraso contado no **fuso do evento** ("vence hoje" não é atrasado); **comentários com menção** (a menção é LINHA, não texto procurado) avisando por e-mail e caixa de entrada; e o cartão movido por **arrastar e soltar ou por formulário** — o quadro é operável **sem JavaScript**, o que quita a metade da E50 que dá para quitar sem reescrever uma dúzia de telas | ADR-200 … 212 |
| [`docs/fase-39-rubrica-livre.md`](docs/fase-39-rubrica-livre.md) | **Rubrica com número livre de critérios:** a avaliação aceita de 1 a **12** critérios (o teto é do serviço, não da tela), a **chave** de cada critério nasce do rótulo (e é preservada nas linhas que já existem), e a **FORMA** da rubrica — chaves, pesos e notas máximas — **congela a partir do primeiro parecer**, porque acrescentar critério deixa todo parecer existente sem nota e remover renormaliza os pesos em silêncio. Rótulo, descrição e ordem continuam livres; a trilha passou a ser **editável**; e sem JavaScript o editor oferece as linhas do teto (nenhum botão morto) — com o envio provado pelo E2E | ADR-213 … 218 |
| [`docs/fase-40-editor-visual-do-certificado.md`](docs/fase-40-editor-visual-do-certificado.md) | **Editor visual do certificado:** o desenho deixou de ser código — arte de fundo da instituição (JPEG RGB, embutido no PDF **como está**, com a orientação EXIF virada matriz de desenho) e elementos posicionados **em milímetros**, arrastando no palco **ou** digitando as medidas (funciona sem JavaScript). Texto por **variáveis** (nome, evento, atividade, carga horária, período, código de validação, QR), **cinco modelos prontos** para personalizar, **prévia** pelo mesmo renderizador do PDF e o bloco probatório **obrigatório**. O desenho é **congelado em cada certificado** na emissão (conteúdo canônico **versão 2**, com a versão 1 seguindo verificável); sem modelo configurado, vale o desenho fixo da FASE 6 | ADR-219 … 226 |
| [`docs/fase-42-experiencia-do-patrocinador.md`](docs/fase-42-experiencia-do-patrocinador.md) | **Experiência do patrocinador:** área de **só leitura** do patrocinador, aberta por **vínculo** (convite com token hasheado **ou** vínculo direto pela equipe) e não pelo papel; **QR do estande** por evento com **imagem pronta para imprimir** (e download em PNG/SVG) e XP e/ou carta creditados **uma vez por pessoa por QR**; leitura pública com a escolha entre **autorizar** ou **registrar sem compartilhar** — com o **mesmo crédito** nos dois caminhos, porque consentimento não é pedágio (LGPD art. 8º §3º); lead de **nome e e-mail**, com texto lido, versão, **prazo** e **revogação** decididos na leitura; painel da organização com QR, equipe do patrocinador e **exportação em CSV** dos contatos vigentes; e a **armadilha 97** descoberta no caminho (erro engolido dentro da transação faz o `COMMIT` virar `ROLLBACK` silencioso) | ADR-230 … 232 |
| [`docs/armadilhas.md`](docs/armadilhas.md) | **Armadilhas conhecidas do projeto:** as 97 que custaram depuração real, com sintoma, causa raiz e correção — a tabela completa que o `AGENTS.md` referencia por número | — |
| [`docs/fase-16-sorteios-de-ponta-a-ponta.md`](docs/fase-16-sorteios-de-ponta-a-ponta.md) | Sorteios de ponta a ponta: suplentes, entrega do prêmio, chance por minutos, commit-reveal com semente selada, resultado público com nome mascarado, paginação do histórico, prévia ao vivo e os gatilhos de carta de presença total e revisor destaque | ADR-085 … 091 |
| [`docs/fase-14-quotas-e-planos.md`](docs/fase-14-quotas-e-planos.md) | Quotas de plano aplicadas (eventos e **membros da equipe** — a de **armazenamento** passou a ser aplicada na FASE 21), distinção entre membro e participante no modelo e nas listas, troca de plano e edição de quotas pela UI e tela de equipe na instituição | ADR-080 … 084 |
| [`docs/fase-13-operacao-e-seguranca.md`](docs/fase-13-operacao-e-seguranca.md) | Rate limit no Redis, métricas Prometheus com token, log estruturado com redação, RLS dentro da migração, `audit_logs` particionada por mês com partição `DEFAULT` e PgBouncer em modo transação | ADR-075 … 079 |
| [`docs/fase-12-mutirao-dividas.md`](docs/fase-12-mutirao-dividas.md) | Mutirão de dívidas rápidas: escopo de equipe no credenciamento, evento restrito à comunidade, índice único de concessão, quota de eventos, cache distribuído, diretório sem truncamento e faxina de layout | ADR-071 … 074 |
| [`docs/fase-11a-identidade-visual.md`](docs/fase-11a-identidade-visual.md) | Tokens da identidade, tipografia real, primitivos de UI, shell de navegação, guia de estilo vivo e trava mecânica com catraca de dívida | ADR-064 … 067 |

> A numeração de ADRs é **sequencial e global** ao projeto (não reinicia por fase):
> são **226 decisões** registradas até aqui.

### Convenções da documentação

- **Português** em código, comentários de decisão, documentação e mensagens de erro
  (o produto é para instituições brasileiras).
- Comentários explicam **por que**, nunca "o que" — o código já diz o que faz.
- Decisões não óbvias viram **ADR**; defeitos encontrados por testes viram **lição
  aprendida** com sintoma, causa raiz e correção.
- Números de teste nas evidências são os **reais** do momento da fase.

---

## 12. Arquitetura em uma página

```text
src/
├── domain/            regras puras, sem Prisma e sem Next (testáveis isoladamente)
│   ├── tenancy/       resolução de instituição, slugs e validação; papéis e ciclo de
│   │                  vida do membro (remoção lógica, guarda do último proprietário)
│   ├── rbac/          papéis, permissões e o `can()` (fail-closed)
│   ├── events/        ciclo de vida, inscrições, agenda, landing page
│   ├── review/        submissão, rubrica, afinidade, conflito de interesse e
│   │                  inspeção de arquivos (portão do download)
│   ├── platform/      catálogo das rotinas automáticas (cadência, estados e saúde)
│   ├── gamification/  XP, níveis, cartas, missões
│   └── certificates/  elegibilidade, carga horária, código e conteúdo canônico
├── lib/               aplicação e infraestrutura
│   ├── db/            cliente com contexto de tenant (RLS), cliente admin, erros do Prisma
│   ├── auth/          sessão, guarda de páginas
│   ├── events/        inscrições, credenciamento
│   ├── review/        submissões, avaliação por pares e varredura de arquivos
│   ├── gamification/  motor de recompensas, serviços, ganchos
│   ├── certificates/  assinatura, renderização (PDF/SVG), serviço, fila
│   ├── documents/     escritor de ZIP sem dependência (lote de certificados)
│   ├── admin/         trilha de auditoria e catálogo do painel
│   ├── platform/      governança global: repositório administrativo, serviços,
│   │                  diretório público, guarda de plataforma (404), registro das
│   │                  execuções (`job_runs`) e manutenção das partições
│   ├── storage/       cliente S3/MinIO (URLs pré-assinadas), quota e driver de inspeção
│   └── tenancy/       resolução e cache de instituição
├── app/               Next.js
│   ├── actions/       Server Actions (toda autorização é verificada aqui)
│   ├── api/           Route Handlers (auth, health, download, exportação e lote em ZIP)
│   ├── (public)/organizacoes     diretório público de instituições
│   ├── superadmin/               painel de governança da plataforma
│   ├── instituicao-bloqueada/    página de bloqueio (instituição suspensa)
│   ├── t/[tenantSlug]/(public)  landing pages sem autenticação
│   ├── t/[tenantSlug]/(app)     painel autenticado
│   └── validar/[code]           validação pública de certificado
├── components/        UI por domínio (review, gamification, certificates, admin…)
└── workers/           entrypoint do worker BullMQ (certificados, e-mails e as 5 rotinas)
prisma/
├── schema.prisma      modelo de dados
├── migrations/        migrações (índices parciais, policies e particionamento à mão)
├── scripts/           RLS, contrato de schema, isolamento, pooling e partições
└── seed.ts            dados de demonstração
tests/
├── unit/              1497 testes de regra pura e de formato (sem banco) — 52 arquivos
├── integration/        648 testes com banco, Redis e storage reais — 41 arquivos
└── e2e/               142 testes Playwright contra o container
```

**Cinco decisões que explicam o resto:**

1. **Domínio puro e sem ORM.** As regras (`src/domain`) não importam Prisma nem Next,
   então podem ser testadas isoladamente e reusadas no cliente (paleta de carta,
   tema de página).
2. **Todo acesso a dados passa por `withTenant()`.** O contexto da instituição é
   aplicado por transação (`SET LOCAL app.tenant_id`), propagado por
   `AsyncLocalStorage` — nunca por `SET` global, que vazaria entre requisições. É
   exatamente isso que torna o PgBouncer em modo transação seguro.
3. **A RLS é a última linha de defesa, não a única.** Autorização é verificada em
   layouts, páginas e Server Actions; a policy garante que um filtro esquecido não
   vire vazamento — e vale também para cada partição da auditoria.
4. **O banco decide o que é concorrência.** Vaga, posição na fila, tiragem de carta e
   crédito de XP usam índice único e `UPDATE` condicional — o retorno de 0 linhas é a
   resposta de negócio.
5. **Documento é dado, não tela.** Certificado tem snapshot imutável, hash e
   assinatura sobre conteúdo canônico; o renderizador (PDF/SVG) é apresentação.

---

## 13. Segurança e isolamento multi-tenant

```bash
npm run db:verify              # contrato: RLS + FORCE + policy em toda tabela de tenant
npm run db:verify:isolation    # 9 ataques reais entre instituições
npm run db:verify:pooling      # o mesmo isolamento, através do PgBouncer (perfil `pooler`)
```

Os 9 cenários provam, contra o banco real:

```text
[A1] sem contexto de tenant, nenhuma linha é visível (fail-closed)
[A2] tenant A enxerga apenas os próprios eventos
[A3] UPDATE em dado de outro tenant afeta 0 linhas
[A4] DELETE em dado de outro tenant afeta 0 linhas
[A5] INSERT com tenantId de outro tenant é rejeitado pelo WITH CHECK
[A6] vínculos de usuário isolados
[A7] COUNT(*) agregado conta apenas o próprio tenant
[A8] contexto não vaza para a conexão seguinte do pool (SET LOCAL)
[A9] a role de runtime não desliga a RLS nem escala privilégio
```

E a prova de pooling (FASE 13) mostra que a garantia sobrevive à reutilização de
conexão, que é o que o modo transação faz:

```text
✓ depois do COMMIT a mesma conexão não carrega contexto
✓ nenhuma das 8 transações concorrentes viu o contexto de outra
✓ 8 clientes simultâneos couberam em no máximo 5 conexões de servidor
```

Duas consequências práticas:

- **Criou tabela com `tenantId`?** Rode `npm run db:rls` e depois `npm run db:verify`.
  Uma tabela com RLS habilitada e sem policy é *fail-closed*: a aplicação não lê nada.
- **Nunca** conceda `BYPASSRLS` ou `SUPERUSER` à role de runtime: `db:verify` falha e
  o isolamento deixa de existir.
- **Criou tabela particionada?** A verificação das partições é automática: o contrato
  exige RLS + FORCE + policy em toda tabela com `relispartition`.

---

## 14. Solução de problemas

| Sintoma | Causa | Solução |
|---|---|---|
| Container `postgres` reinicia em loop | Volume montado em `/var/lib/postgresql/data`; o PostgreSQL 18 usa `/var/lib/postgresql` (diretório pai) | Corrija o volume em `docker-compose.yml` ou recrie com `npm run infra:reset` |
| Build falha em `/_global-error` com `useContext` nulo | `.env` define `NODE_ENV=development`, carregado pelo Next durante o build | Use `npm run build` (aplica `NODE_ENV=production`) — **não** rode `next build` direto |
| Build falha com "You are using the default secret" | `BETTER_AUTH_SECRET` ausente no momento do build | Defina a variável no `.env` (e nos `args` do Dockerfile em produção) |
| Rota nova responde **404** e o container parece saudável | O `--build` falhou e o Compose manteve o container anterior | Veja o log completo do build; confirme `docker images \| grep eventflow/web` e recrie |
| "Server Actions must be async functions" | Arquivo `'use server'` exporta função não-async | Torne a função `async` ou mova o utilitário para outro módulo |
| Tabela nova não retorna nada | RLS habilitada sem policy (fail-closed) | `npm run db:rls` → `npm run db:verify` |
| E2E derruba com HTTP 429 | Rate limiter do Better Auth | `RATE_LIMIT_ENABLED=false` no `.env` do container (desde a FASE 13 o contador é no Redis e vale entre instâncias) |
| `/api/metrics` responde **404** | Em produção, sem `METRICS_TOKEN`, o endpoint não existe de propósito | Defina `METRICS_TOKEN` no `.env` e consulte com `Authorization: Bearer <token>` |
| `npm run db:verify:pooling` falha com "connect ECONNREFUSED 6432" | O PgBouncer está no perfil `pooler` e não sobe por padrão | `docker compose --profile pooler up -d pooler` |
| Linhas de auditoria caem em `audit_logs_default` | Mês sem partição criada | Agende `npm run db:partitions` (host/cron); ele cria a partição e **move** as linhas da `DEFAULT` |
| `CREATE TABLE ... PARTITION OF ... FOR VALUES` falha com "bind message supplies 2 parameters" | O PostgreSQL não aceita parâmetro em DDL | Interpole o limite da partição como literal `'AAAA-MM-01'` |
| Certificado inválido na página pública | Chaves de assinatura diferentes entre web e worker | Use o mesmo `CERTIFICATE_HMAC_SECRET` (e `KEY_ID`) nos dois serviços |
| Seed falha com "nenhuma linha visível" | O seed precisa de contexto: ele usa `set_config` por tenant | Rode via `npm run db:seed` (nunca copie o SQL sem o contexto) |
| `docker compose up` sem MinIO | As imagens oficiais do MinIO foram removidas do Docker Hub/Quay (2025) | O projeto já usa a imagem da Chainguard + `docker/minio/Dockerfile.probe`; rode `docker compose build minio` |

---

## 15. Limitações conhecidas

Registradas nas dívidas técnicas de cada fase — nenhuma escondida:

1. **Assinatura de certificado é HMAC (simétrica).** Permite à instituição validar os
   próprios documentos; validação offline por terceiros que não confiam na instituição
   exigiria PKCS#7/CMS com X.509 (o campo `signatureAlg` já está preparado).
2. **Mídia: o acervo cresce sem miniatura nem busca (FASE 24).** A biblioteca de mídia
   resolveu o essencial — registro, reaproveitamento por checksum e exclusão que confere o
   uso — mas a lista carrega a **imagem inteira** para desenhar um quadrado pequeno (E18) e
   traz as 200 mais recentes **sem filtro** por tipo, evento ou uso (E19). A sincronia do
   patrocinador copiado é **por patrocinador** (E20): uma instituição com muitas edições
   sincroniza uma cópia por vez. `EventPage.theme` (tema por página) segue reservado e sem
   uso: o tema é do evento, para não existirem duas fontes de verdade para a mesma cor.
3. **O vínculo é único por (instituição, pessoa): remover a equipe tira o acesso de
   participante (FASE 21, dívida C7).** A remoção é lógica (`REMOVED` + todas as
   concessões revogadas) e o diálogo **avisa** quando a pessoa tem inscrições — mas não
   existe "rebaixar para participante" (nem separar as duas relações em duas linhas):
   quem era equipe e público perde a porta de entrada da própria área de participante,
   com as inscrições e os certificados preservados no banco.
4. **A quota de armazenamento mede o BANCO, não o bucket (FASE 21, dívida C6).** Ela é
   conferida **antes de assinar a URL de upload** nos três caminhos (submissão, mídia e
   material de palestrante), desconta o arquivo substituído no rascunho e recusa com
   `QUOTA_EXCEEDED`; o **certificado é medido e nunca bloqueado** (o documento do
   participante não depende da decisão de armazenamento da instituição). O que ela não
   faz: reconciliar objeto que ficou no bucket sem registro (envio interrompido no meio)
   nem apagar o arquivo quando o registro sai — a limpeza é manual, e a diferença só
   aparece na conta do provedor.
5. **Paginação** nas listagens administrativas é por limite de consulta.
6. **Auditoria de leitura**: a trilha registra mutações; visualização de dado pessoal
   não é registrada (exceto o contador de validação pública).
7. ~~**Antivírus nos arquivos de submissão** (`scanStatus = SKIPPED`, marcado
   honestamente em vez de afirmar "limpo").~~ **Entregue na FASE 36 (quita A3):** driver de
   inspeção cujo **padrão é NÃO inspecionar** (`SKIPPED`, servido e declarado como não
   inspecionado), rotina `file-scan` no worker, portão de download nos dois caminhos que servem
   bytes de terceiro (submissão e material de palestrante) e trilha da ameaça. Para ligar:
   `docker compose --profile av up -d clamav` + `SCAN_DRIVER=clamav`.
8. **Notificações por e-mail** (atribuição de parecer, certificado emitido) dependem
   do worker; a fila existe, o envio não.
9. **Adoção do log estruturado é parcial (FASE 13).** Os pontos de operação (fila,
   worker, rate limit) usam o `logger` com redação; os serviços ainda têm ~66
   `console.*` (dívida B6).
10. **Retenção da auditoria** é decisão de negócio, não código: ~~o agendamento das partições~~
    **foi entregue na FASE 36 (quita B7)** — a rotina `audit-partitions` do worker cria o mês
    atual e os seguintes todo dia às 3h, com a CLI mantida para quem opera sem worker — mas
    **nada é descartado** (dívida B8): a manutenção cria e nunca apaga.
11. **Não há coletor de métricas.** `/api/metrics` é o contrato; Prometheus/Grafana e
    alertas ficam com quem opera (dívida B9).
12. **Sorteios: a operação de palco chegou na FASE 22, e a antiga limitação caiu.** Desfazer
    uma entrega registrada por engano (com motivo obrigatório na trilha), filtrar o histórico,
    premiar N revisores pela tela, endereço próprio do resultado publicado e prévia ao vivo
    por SSE com polling de volta — as seis dívidas do tema (G8–G13) foram quitadas. O que
    **fica declarado**: o consentimento para publicar o nome completo no resultado ainda
    depende de SQL (dívida E35) — o padrão é NÃO publicar, e quem quer se identificar não tem
    tela para pedir (ADR-139).
13. **A política de privacidade do resultado público foi corrigida na FASE 22.** O campo que
    autoriza o nome completo nasceu ligado por padrão, então o nome dos ganhadores saía
    inteiro contra a regra documentada; o padrão passou a ser mascarar, e as contas
    existentes foram normalizadas.
14. **Imagens do evento: allowlist fechada (FASE 17).** Capa e logotipos aceitam apenas
    PNG, JPEG, WebP e AVIF — SVG é recusado de propósito, porque um SVG pode conter script
    e seria executado no navegador do visitante. GIF e TIFF ficam de fora por decisão, não
    por esquecimento.
15. **O documento fiscal do patrocinador (CNPJ/CPF) é gravado, exibido mascarado e nunca
    entra na trilha de auditoria** — e não há como removê-lo pela tela (exige SQL): apagar
    dado fiscal é ato deliberado, não efeito colateral de salvar um formulário.
16. **Restaurar uma versão da página não devolve o estado de publicação (FASE 23).** O
    conteúdo volta; `isPublished`, `publishAt` e `unpublishAt` ficam como estão — um
    "desfazer" que publicasse ou tirasse a página do ar seria uma surpresa cara. O histórico
    guarda as 20 versões mais recentes por página (dívida E12, resolvida, com teto declarado).
17. **A exclusão de mídia procura o uso por URL, não por chave estrangeira (FASE 24).** O
    conteúdo do bloco aceita imagem externa, então a referência é a URL: o serviço varre
    capa, logotipos e blocos antes de apagar e **recusa** quando encontra — mais caro que um
    `ON DELETE`, e é o que responde a pergunta do organizador. URIs que não sejam `http(s)`
    escritas à mão em campo livre não entram na varredura. A deduplicação é por **checksum
    exato**: reencodar a mesma foto gera um segundo objeto.
18. **A página sai do ar pela data, mas o visitante que já está na tela não é avisado
    (FASE 24).** A decisão é tomada na leitura (sem agendador): quem recarregar depois do
    término recebe 404, e quem já carregou continua lendo o que estava lá. A rota pública é
    `force-dynamic` (sem cache), então não existe janela de conteúdo obsoleto servido.
19. **O convite de palestrante é entregue à mão (FASE 25, dívida E25).** A plataforma ainda
    não envia e-mail (F15 pendente), então a organização copia o **código** da tela e o
    entrega ao convidado. O código aparece **uma única vez** (o banco guarda só o SHA-256):
    se for perdido, gera-se outro — e o anterior deixa de funcionar.
20. **A integridade do material confere o tamanho, e o checksum quando o storage o reporta
    (FASE 25, dívida E26).** O upload é assinado sem o metadado `x-amz-meta-sha256`, então o
    MinIO não devolve o hash e a conferência fica no tamanho — o mesmo caminho desde a
    FASE 4. Um objeto trocado por outro de **mesmo tamanho** passaria.
21. **A foto do palestrante entra por upload, não por URL (FASE 25, dívida E27).** É a
    mesma esteira da capa (allowlist de tipo + assinatura real do arquivo + biblioteca de
    mídia); quem hospeda a foto fora precisa baixá-la e enviá-la.
22. **Desvincular um palestrante de uma atividade despublica os materiais dele ali (FASE 25).**
    Material é do par (palestrante × atividade): sem o vínculo, ele perderia o dono e
    continuaria na página. A exclusão é lógica (a trilha guarda quem enviou), e a tela diz
    isso antes de confirmar.
23. **O convite também abre pelo e-mail da conta, e o endereço ainda não é verificado
    (FASE 25, revisão — dívida E30).** Quem tem convite pendente para o **e-mail da própria
    conta** entra no portal e assume o perfil sem precisar do código: é o caminho que faz o
    convite aparecer na área do palestrante. Como a verificação de e-mail é da F15, quem
    conseguisse criar uma conta com o endereço convidado assumiria o perfil — o mesmo grau de
    confiança do aceite pelo painel, registrado na auditoria e reversível pelo desvínculo.
24. **O autor exclui rascunhos, mas não RETIRA uma submissão enviada (FASE 4, revisão —
    dívida E31).** Excluir só alcança `DRAFT`: depois do envio existem atribuições, pareceres
    e o snapshot de autoria apontando para a submissão, e apagá-la seria reescrever a história
    da avaliação. O estado `WITHDRAWN` existe no domínio (e o limite da trilha já o ignora),
    mas ainda não há serviço nem tela que o produza — por isso a tela de exclusão manda falar
    com a comissão em vez de prometer um caminho que não existe.
25. **A trilha do rascunho não muda pela interface (FASE 4, revisão — dívida E32).** Título,
    resumo, palavras-chave e idioma são editáveis enquanto a submissão não foi enviada; trocar
    a TRILHA mudaria a rubrica de avaliação, o requisito de versão cega e a fila de revisores —
    é decisão do comitê. Quem escolheu a trilha errada exclui o rascunho e cria outro.
26. **O evento lotado não tem lista de espera (FASE 3, revisão — dívida E33).** A fila FIFO
    existe por ATIVIDADE (com vaga e promoção automática). A inscrição **no evento** — criada
    na revisão — consome a lotação do evento e, quando ela acaba, **recusa** com "a lotação
    total do evento foi atingida": não há fila de espera no nível do evento nem promoção
    quando uma vaga abre. Quem não coube simplesmente não entra, e a organização não vê a
    demanda represada.
27. **O envio de e-mail real depende de um domínio verificado (FASE 15, dívida D7).** A conta
    do Resend usada hoje é de **teste**: o remetente precisa ser `onboarding@resend.dev` e o
    provedor **só entrega para o endereço dono da conta** — qualquer outro destinatário volta
    `403` (que a plataforma registra como falha definitiva, com o motivo do provedor, em
    "Falhas"). Enquanto isso, o driver `log` é o modo de operação de desenvolvimento e de
    teste: a mensagem é registrada no outbox e **não sai**. E `SENT` significa "aceito pelo
    provedor", não "entregue na caixa": não há webhook de entrega (dívida D8) nem preferências
    de notificação (D9).
28. **A verificação de e-mail não bloqueia o login (FASE 15).** É decisão consciente: ligar o
    bloqueio trancaria fora toda conta já existente, inclusive as de teste. A plataforma envia
    a confirmação, avisa no shell e permite reenviar — mas quem não confirmar continua entrando.
29. **A sala de uma atividade ABERTA não limita o público do evento (revisão da FASE 3, dívida
    E34).** O teto da sala vale para as atividades com inscrição própria — minicursos e oficinas,
    justamente as que acontecem em sala —, aplicado na reserva da vaga. Atividade aberta recebe
    automaticamente quem se inscreveu no evento e não tem fila: barrar ali significaria negar
    acesso em silêncio a quem já está inscrito, por causa de uma sala escolhida depois. O painel
    **avisa** quando o público do evento excede a capacidade da sala, com os dois números, e a
    decisão (sala maior, atividade com vagas ou limite no evento) fica com quem organiza.

30. **A lista auditável do sorteio não pode ser comprometida antes da apuração (FASE 29, dívida
    E36).** O compromisso assina a **semente**, publicada na criação; a lista de elegíveis só
    existe no momento da apuração, porque o credenciamento continua aberto até lá. A auditoria
    prova que a semente foi fixada antes, que a lista publicada gerou o resultado gravado e que
    nada mudou depois — e **declara na própria página** que não prova a autenticidade da lista
    contra quem tem acesso ao banco. Fechar isso exigiria notarização externa do compromisso ou
    congelar o credenciamento antes do sorteio, o que descaracterizaria o sorteio por presença
    real.
31. **O telão fica no ar desde a criação do sorteio (FASE 29, dívida E37).** O endereço do palco
    (`.../sorteios/<id>/palco`) responde desde a criação e mostra o título do prêmio, para que o
    organizador teste o telão antes do evento e projete o **mesmo link** no dia. Não há
    interruptor para manter o palco desligado até a hora do anúncio: quem tem o link (um UUID
    não enumerável, com `noindex`) vê o título antes da apuração.
32. ~~**O prêmio anunciado de uma rodada não pode ser corrigido pela tela (FASE 30, dívida E38).**~~
    **Quitada na FASE 35:** a edição do anúncio (prêmio e patrocinador) está desacoplada do
    documento assinado, com o telão reagindo por SSE sem invalidar o hash do resultado.
33. ~~**O credenciamento não funciona sem rede (FASE 31, dívida E40).**~~ **Quitada na FASE 35:**
    o balcão é **offline-first em IndexedDB**, com sincronização idempotente e cronológica
    (`idempotencyKey` + `Attendance.qrNonce`) quando a rede volta. ~~E41~~ (impressão em etiqueta
    adesiva e impressora térmica) foi **quitada na FASE 37**; continua aberta a **E42**
    (identidade visual do crachá e escolha da lente da câmera); ~~E43~~ foi quitada na FASE 35 com
    o **seletor de sentidos** (`IN`, `TOGGLE`, `OUT`) imune a bipes duplos e rajada.
34. ~~**A roleta do telão tem duração fixa e não pode ser repetida nem desligada (FASE 30, dívida
    E39).**~~ **Quitada na FASE 35:** o palco tem **pausa/retomada, replay e atalhos de teclado**.
35. **O arquivo exportado não tem prazo nem controle de destino (FASE 32, dívida E44).** O CSV da
    central do participante sai com o e-mail completo (é o insumo da ação, não uma vitrine) e
    passa a viver em pasta compartilhada, e-mail e pen drive. A trilha registra quem exportou e
    quantas linhas, mas não impede que o arquivo circule anos depois. Falta marca d'água com autor
    e data, prazo declarado na tela e uma política de retenção combinada com a instituição.
36. **O recado ao participante é mão única (FASE 32, dívida E45).** A instituição fala, a pessoa
    lê (e a ficha mostra "não lido"), mas não há resposta pela plataforma nem thread — e "não
    lido" não é o mesmo que "não recebido". Falta a resposta na própria caixa de entrada e o
    indicador de resposta na ficha.
37. **A impressão do crachá é configurável, e a responsabilidade pela medida é de quem imprime
    (FASE 37).** A folha adesiva e a etiqueta térmica saem com o padrão mais comum (3 × 8 de
    63,5 × 33,9 mm em A4; 203 dpi · 100 × 50 mm) e a tela deixa ajustar os números — o que o
    sistema faz é **recusar** o que não cabe ou o que ele não entende, antes de gastar material.
    Ficam declarados: a **identidade visual do crachá** (logo, cor do tema, faixa por categoria) e
    a **escolha da lente da câmera** continuam abertas (dívida E42), e o arquivo baixado não tem
    prazo nem marca d'água (mesma família da E44).
38. **Quem é promovido da lista de espera recebe o checklist com a vaga JÁ confirmada (FASE 37).**
    É a decisão da promoção desde a FASE 34 (cobrar uma segunda confirmação de quem acabou de ser
    chamado seria criar outra forma de perder a vaga): o balcão pode registrar o que a pessoa
    trouxe, e o item não segura nada. Cobrar a entrega de quem foi promovido seria decisão de
    negócio, não defeito.
39. **A ação em linha só existe depois de hidratada (FASE 37, dívida E50 — metade quitada na
    FASE 38).** O formulário chega no HTML do servidor, mas quem o envia é o cliente: um clique
    antes de o bundle carregar é absorvido pelo React e **não vira requisição** (provado pela
    trilha de rede no E2E). O **quadro de demandas** (FASE 38) já não depende disso — o
    formulário do cartão usa `action` nativa e o E2E move um cartão com o JavaScript DESLIGADO —,
    mas o componente compartilhado `InlineActionForm` continua na mesma situação: o
    `<form action={...}>` do React só aceita `(formData) => void`, e a ação com `useActionState`
    recebe `(prev, formData)`. Quitar a raiz é converter as ações de linha de uma dúzia de telas.
40. **O quadro de demandas carrega todos os cartões do evento (FASE 38, dívida E52).** A leitura
    traz as demandas do quadro inteiro numa consulta. Num evento com centenas de demandas abertas
    — ou num histórico de anos — a tela de operação abre com tudo. Falta paginar por coluna,
    deixando as concluídas fora do primeiro carregamento.
41. **O quadro de demandas não reordena por teclado (FASE 38, dívida E51).** O arrastar reordena
    e move entre colunas, e o formulário do cartão move de coluna — mas reordenar **dentro** da
    coluna só existe pelo gesto do mouse. A ordem é informação de prioridade: falta o caminho por
    teclado ("mover para cima/baixo"), que o serviço já suporta (`toIndex`).
42. **A demanda não se liga à programação (FASE 38).** O cartão é texto livre: não aponta para uma
    atividade nem para uma sala. Ficou fora de escopo de propósito — a ligação convida a
    automações (concluir a demanda quando a atividade termina, bloquear a publicação sem
    checklist) que esta fase não teria como testar.
43. **A rubrica congela depois do primeiro parecer (FASE 39).** O organizador escolhe de 1 a 12
    critérios enquanto ninguém avaliou; a partir do primeiro parecer, o número de critérios, as
    chaves, os pesos e as notas máximas não mudam mais (rótulo, descrição e ordem continuam
    livres). A razão é aritmética: acrescentar critério deixa todo parecer existente sem nota em
    um deles, e remover renormaliza os pesos — as notas já dadas passariam a significar outra
    coisa. Quem precisa de outra régua cria outra trilha ou outra chamada.
44. **A contagem que congela a rubrica da trilha é conservadora (FASE 39, dívida E53).** Ela conta
    pareceres de submissões da trilha sem checar se aquela submissão usa mesmo a rubrica dela
    (uma chamada com rubrica própria vence a da trilha). Erra para o lado de congelar, e a
    mensagem diz o que contou.
45. **O editor visual do certificado é opt-in, e a arte é da instituição (FASE 40).** Sem modelo
    configurado, o certificado continua saindo no desenho fixo da FASE 6 e o conteúdo assinado segue
    na versão 1 — ninguém ganha um documento visualmente diferente por causa de uma fase que não
    pediu. A arte de fundo **não** vem com os modelos prontos: identidade institucional não se
    sugere. E só as 14 fontes padrão do PDF são oferecidas — a fonte da instituição exigiria embutir
    o binário, e aí o hash do documento passaria a depender dele.
46. **CPF e "título da apresentação" ficaram fora do catálogo de variáveis (FASE 40, dívida E54).**
    Nenhuma das duas tem fonte no modelo de hoje: o participante não tem campo de documento e o
    certificado não se liga à submissão. Oferecer a variável assim mesmo faria o documento formal
    sair com um rótulo vazio — então ela não aparece, e a dívida registra as duas fontes que faltam
    (campo do participante, com decisão de privacidade, e o vínculo com a submissão).
---

**Próximos passos sugeridos:** fechar as dívidas por prioridade de risco — verificar um
domínio no Resend para o e-mail chegar a qualquer destinatário (D7, que é operação de conta e
destrava o uso real), PKCS#7 para uso institucional (F18) — e depois a
reconciliação entre banco e bucket e o acesso de participante na remoção (C6 e C7, que a
FASE 21 declarou), o consentimento de perfil público (E35), a autenticidade da lista auditável
do sorteio (E36), o interruptor do telão (E37), a identidade visual do crachá e a lente da
câmera (E42), a retenção do arquivo exportado (E44), a resposta ao recado (E45), o prazo-limite
da atividade (E49), a ação em linha que funcione sem JavaScript (E50, já pela metade), a
paginação e a reordenação por teclado do quadro de demandas (E51 e E52), a contagem exata do
congelamento da rubrica (E53), o CPF e o título da apresentação como variável do certificado
(E54, que precisa das duas fontes) e o movimento por teclado no palco do editor (E55), o segundo
grau do acervo
de mídia (F26: miniaturas, busca e sincronia em lote), o material/convite do palestrante (F27,
que agora só precisa do template) e a entrega de e-mail de segunda ordem (F28: webhooks e
preferências).
O levantamento atualizado está em [`docs/dividas-tecnicas.md`](docs/dividas-tecnicas.md).





