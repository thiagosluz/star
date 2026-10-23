# Fases 1 a 25 — o histórico que saiu do `AGENTS.md`

> **O que é este arquivo.** O registro das fases **1 a 25** — incluindo **11A** e **11B** —,
> movido **como estava** do `AGENTS.md` na **FASE 79**: a tabela da §9 carregava todas as
> fases desde a 1 e encostava no teto de ~64.800 bytes daquele arquivo, cujo corte do harness
> apaga conteúdo em silêncio. **Não é um resumo novo**: cada linha é a linha que estava lá,
> inclusive as reticências ` … ` das condensações anteriores.
>
> **Onde está o registro completo.** Cada fase tem o seu documento em `docs/fase-NN-*.md`
> (ADRs, lições aprendidas, evidências e comandos), e o `README.md` traz o índice da
> documentação.
>
> **Onde está a tabela corrente.** No [`AGENTS.md`](../AGENTS.md), §9: ela guarda as fases
> recentes e o estado atual. A tabela abaixo é histórica e **não cresce** — fase nova entra
> na corrente.
>
> **A ordem é a cronológica da tabela original**, não a numérica: a numeração identifica o
> TEMA, e é o humano quem o escolhe pelo nome — por isso a F16, a F17, a F23, a F24 e a F25
> vieram antes da F15, e a F21 foi entregue depois de todas.

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
