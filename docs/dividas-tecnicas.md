# Levantamento de dívidas técnicas — o que falta implementar

> **Documento vivo.** Reúne as dívidas e pontos de atenção declarados nas FASES 1 a 11B,
> verifica quais continuam abertos **no código de hoje** e propõe um agrupamento para
> implementação. Atualize-o quando uma fase quitar itens — o histórico do que já foi
> resolvido está na seção 2, para que este documento não repita trabalho feito.
>
> Levantamento feito em **2025-09-17**, sobre a árvore em `FASES 1 a 11B (70 ADRs)`.

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

---

## 3. Resumo por tema

| Tema | Itens abertos | Dos quais rápidos (P) | Risco se ficar como está |
|---|---|---|---|
| A. Segurança e conformidade | 5 | 1 | Alto — rate limit não vale entre instâncias; arquivos sem varredura |
| B. Confiabilidade e operação | 5 | 2 | Alto — sem métricas nem particionamento; RLS fora das migrações |
| C. Quotas e billing | 2 | 1 | Médio — quota de plano é decorativa |
| D. Comunicação e comunidade | 6 | 1 | Alto para adoção — não há um único e-mail; convite é manual |
| E. Jornada do participante | 8 | 3 | Médio — atrito e listas sem paginação |
| F. Gamificação | 6 | 2 | Baixo — mecânicas já existem sem gatilho automático |
| G. Sorteios | 7 | 2 | Médio — sorteio é completo, mas o prêmio não é entregue nem registrado |
| H. Design e acessibilidade | 4 | 2 | Baixo — aparência consistente; composição heterogênea |
| I. Plataforma e diretório | 2 | 0 | Baixo a médio |
| **Total** | **45** | **12** | (8 quitados na FASE 12) |

---

## 4. Levantamento detalhado

### A. Segurança e conformidade

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| A1 | **Rate limit distribuído** | F2, F3, F4 | Limitador do Better Auth é em memória/por processo (`src/lib/auth/auth.ts`); migrar para Redis com chave por IP+rota e janela deslizante | Com 2+ instâncias, o limite não protege nada | M | Sim |
| A2 | **Assinatura assimétrica de certificado (PKCS#7/CMS)** | F1, F6 | Trocar HMAC por chave privada + certificado; `signatureAlg`/`keyId` já preparados; exige cofre de chave | Terceiros não validam offline sem confiar na instituição | G | Decorrente |
| A3 | **Antivírus nos arquivos de submissão** | F4, F6 | `scanStatus` é `SKIPPED` (`submission-service.ts`); integrar ClamAV ao worker | Arquivo malicioso armazenado e servido por URL assinada | M | Sim |
| A4 | **Auditoria de leitura de dados pessoais** | F7 | A trilha registra mutações; quem **visualizou** não é registrado | Sem rastro em incidente de acesso indevido | M | Decorrente |
| A6 | **Login social (Google/ORCID)** | F2 | Tabela `account` é multi-provedor; falta o provedor e as credenciais | Atrito de cadastro em público acadêmico | M | Sim |

### B. Confiabilidade e operação

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| B1 | **Observabilidade** | F-debt geral | Nenhum OpenTelemetry/métrica; 65 `console.*` como único sinal | Não há como ver latência, fila ou erro por rota | M | Sim |
| B2 | **RLS fora das migrações** | F1 | Policies vivem em `docker/postgres/init/` e dependem de `npm run db:rls`; `migrate deploy` sozinho não as aplica | Ambiente novo sem RLS se alguém esquecer o script | M | Sim |
| B3 | **Particionamento do `AuditLog`** | F1 | Tabela cresce indefinidamente; particionar por mês em `createdAt` | Consulta e manutenção degradam com o tempo | M | Sim |
| B4 | **PgBouncer (transaction pooling)** | F1, F2 | Contexto por transação já é compatível; a peça não foi adicionada | Teto de conexões em escala | P | Sim |
| B5 | **`unstable_cache` → `use cache`** | F9 | API legada no diretório público | Dívida de atualização do framework | P | Sim |

### C. Quotas e billing

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| C1 | **`Tenant.maxMembers` não é aplicado** | F10 | O valor é gravado e exibido, mas nenhum caminho conta vínculos nem recusa | Quota do plano é decorativa; com inscrição pública o número cresce sem aviso | M | Sim |
| C3 | **Edição de plano e quotas pela UI** | F9 | Trocar de plano depois do provisionamento exige SQL | Operação de billing manual | P | Sim |

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
| E3 | **Editor visual da landing page** | F7 | `PageBlock`, `themeSchema` e `resolveTheme` prontos desde a F3; falta a UI de composição | Instituição não monta a própria página | G | Sim |
| E4 | **Upload de imagem de capa** | F3, F7 | `coverImageUrl` existe e é renderizado; falta a tela de upload (storage pronto desde a F4) | Página pública sem imagem própria | P | Sim |
| E5 | **Cadastro de patrocinadores pela UI** | F7 | `SponsorTier`/`Sponsor` existem e a landing renderiza; `SPONSOR_MANAGE` não tem tela | Bloco de patrocínio inalcançável | M | Sim |
| E6 | **Edição de coautores pela UI** | F4, F7 | `SubmissionAuthor` é criado no envio; ordem/coautores não são editáveis | Correção exige suporte | M | Sim |
| E7 | **Validação de certificados em lote** | F6 | Serviço existe; falta a tela que confere uma lista de códigos | Contratação verifica um por um | P | Sim |
| E8 | **Exportação de certificados em ZIP** | F6 | Nada no código (`zip|archiver|jszip` = 0) | Organizador baixa um a um | M | Sim |

### F. Gamificação

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| F1 | **Gatilhos `REVIEWER_TOP` e `EVENT_ATTENDANCE_FULL` não disparam** | F5 | O gatilho é selecionável na carta, mas nada o aciona (ranking de revisores / check-out) | Carta configurada nunca é concedida | M | Sim |
| F2 | **Trocas e crafting de duplicatas** | F5 | `UserCard.quantity` acumula; não há conversão nem troca | Duplicata sem valor percebido | G | Decorrente |
| F3 | **Níveis de carta** | F5 | `UserCard.level` existe e fica em 1 | Mecânica futura | M | Decorrente |
| F4 | **Histórico de temporadas** | F5 | `seasonXp`/`seasonKey` sem arquivo nem reset agendado | Sem memória de temporada | M | Decorrente |
| F5 | **Ranking por evento** | F5 | Ranking é da instituição; filtrar por evento exige decidir semântica do XP | Relatório por evento limitado | M | Decorrente |
| F6 | **Antifraude de proximidade no credenciamento** | F5 | `latitude`/`longitude`/`qrNonce` existem; validação não | Check-in pode ser feito de qualquer lugar | M | Decorrente |

### G. Sorteios

| # | Item | Origem | O que falta exatamente | Impacto | Esforço | Verificado |
|---|---|---|---|---|---|---|
| G1 | **Suplentes (reservas)** | F8 | Só titulares são sorteados | Sem plano B quando o vencedor falta | M | Decorrente |
| G2 | **Registro de entrega do prêmio** | F8 | Não há registro de retirada nem vínculo com inscrição/credencial | Prêmio sem rastro | M | Decorrente |
| G3 | **Sorteio ponderado por minutos** | F8 | Todos os elegíveis têm a mesma chance | Evolução pedida em alguns eventos | P | Decorrente |
| G4 | **Commit-reveal (semente pública)** | F8 | O hash prova integridade, não que o sorteio foi **depois** do fechamento | Questionamento de auditoria | M | Decorrente |
| G5 | **Exibição pública do resultado** | F8 | Resultado só no painel; expor exige decidir consentimento de nome | Landing não mostra vencedores | P | Decorrente |
| G6 | **Paginação do histórico** | F8 | Limite de 100 sorteios por evento | Histórico longo truncado | P | Decorrente |
| G7 | **Sorteio em tempo real com o credenciamento** | F8 | Prévia exige recarregar para ver presenças novas | Operação no palco | M | Decorrente |

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
| I4 | **Lista de membros poluída por participantes públicos** | F10 | Todo inscrito vira vínculo ACTIVE; não há distinção entre "participante de evento" e "membro" | Lista de membros deixa de ser "a equipe" | M | Sim |
| I6 | **Sigla × nome de instituição** | F4 | `institutionsMatch` não resolve "UFRJ" × nome completo; solução é tabela de instituições | Conflito de interesse com falso negativo | M | Decorrente |

---

## 5. Agrupamento proposto para implementação

Ordenado por **risco que elimina × dependência** (não por facilidade):

| Fase candidata | Tema | Itens | Por que nesta ordem |
|---|---|---|---|
| **F12 — Operação e segurança** | Rate limit em Redis, observabilidade, particionamento do `AuditLog`, RLS nas migrações, PgBouncer | A1, B1, B2, B3, B4 | São os itens que **impedem produção com mais de uma instância**. Não dependem de nada e reduzem risco de tudo o que vem depois |
| **F13 — Comunicação** | E-mail transacional + as notificações que dependem dele + convites de membros + verificação de e-mail | D1, D2, D3, D4, D5, D6, A5 | É o maior bloqueio de adoção: sem e-mail, convite é manual e metade das fases futuras fica travada. Destrava A5 e D3–D6 de uma vez |
| **F14 — Quotas e planos** | Aplicar `maxMembers`, edição de plano pela UI, distinção participante × membro | C1, C3, I4 | Fecha o modelo comercial e limpa a lista de membros que a F10 começou a poluir. A quota de **eventos** já foi aplicada na F12 (C2) — este item herda o mesmo desenho |
| **F15 — Sorteios de ponta a ponta** | Suplentes, entrega de prêmio, pesos, commit-reveal, exibição pública, tempo real | G1–G7 + F1 | Transforma o sorteio (que já é robusto) em **operação completa**, incluindo a carta de presença total |
| **F16 — Landing page e patrocínio** | Editor visual, upload de capa, patrocinadores, coautores | E3, E4, E5, E6 | Habilita a instituição a montar a própria vitrine — o maior item de produto ainda ausente |
| **F17 — Segurança de documentos** | Assinatura assimétrica, antivírus, auditoria de leitura, ZIP, validação em lote | A2, A3, A4, E7, E8 | Documento assinado e arquivo varrido: pré-requisito para uso institucional sério |
| **F18 — Gamificação avançada** | Trocas/crafting, níveis de carta, temporadas, ranking por evento, antifraude de proximidade | F2–F6 | Mecânicas novas; depende de dados reais de uso para calibrar economia |
| **Transversal (sem fase)** | Composição das telas antigas, tema escuro, `use cache`, paginação, fila com prazo, `@axe-core`, regressão visual | H1, H3, H5, H6, I6, B5, E1, E2 | Itens rápidos que não justificam fase própria: entram como carona nas fases acima ou em "mutirões" de meio dia |

### Mutirão executado na FASE 12 (concluído)

Os oito itens abaixo eram o "primeiro mutirão" sugerido por este levantamento e **foram
implementados na FASE 12** — I7, I3, I5, C2, H2, H4, I1 e I2. O registro completo
(ADRs, lições e evidências) está em
[`docs/fase-12-mutirao-dividas.md`](fase-12-mutirao-dividas.md).

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
