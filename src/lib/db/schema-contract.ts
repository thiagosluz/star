/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Contrato de isolamento multi-tenant com o banco.
 *
 *  Este arquivo é a ÚNICA fonte de verdade sobre "quais tabelas são de tenant".
 *  Ele é consumido por:
 *
 *    • prisma/scripts/assert-schema-contract.mjs  — falha o CI/migração se uma
 *      tabela nova com `tenantId` ficar sem RLS.
 *    • prisma/scripts/assert-tenant-isolation.mjs — o teste de integração que
 *      prova, contra um banco real, que um tenant não enxerga o outro.
 *
 *  Se você criar uma tabela com `tenantId` no schema.prisma e esquecer de
 *  adicioná-la aqui, o contrato acusa. Esse é o ponto: tornar o esquecimento
 *  impossível de passar silenciosamente.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Nome da role de runtime (sujeita a RLS). */
export const APP_ROLE = 'eventflow_app';

/** Nome da role administrativa (dona do schema, usada só por CLI/seed). */
export const ADMIN_ROLE = 'eventflow_admin';

/**
 * Tabelas cuja coluna `tenantId` é a fronteira de isolamento.
 * Todas precisam de RLS habilitada, FORCE e a policy `tenant_isolation`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  PARTIÇÕES NÃO ENTRAM NESTA LISTA (FASE 13)
 * ─────────────────────────────────────────────────────────────────────────────
 *  `audit_logs` é particionada por mês, e cada partição (`audit_logs_2026_09`, …)
 *  é uma tabela real com `tenantId`. Elas não podem ser listadas aqui: o nome
 *  depende da data corrente, e uma lista que muda todo mês é uma lista que
 *  alguém esquece de atualizar — exatamente o defeito que motivou a descoberta
 *  por introspecção na FASE 8.
 *
 *  A proteção das partições é verificada ESTRUTURALMENTE em
 *  `assert-schema-contract.mjs` (seção 3b): toda tabela com `relispartition`
 *  precisa de RLS + FORCE + policy, e o script de manutenção
 *  (`prisma/scripts/ensure-audit-partitions.mjs`) aplica as três ao criar cada
 *  partição nova.
 */
export const TENANT_SCOPED_TABLES = [
  'user_tenant_profiles',
  'role_assignments',
  'events',
  'rooms',
  'activities',
  'activity_speakers',
  'speaker_profiles',
  'speaker_materials',
  'event_pages',
  'event_page_versions',
  'page_blocks',
  'media_assets',
  'sponsor_tiers',
  'sponsors',
  'registrations',
  'attendances',
  'tracks',
  'submissions',
  'submission_authors',
  'submission_files',
  'review_assignments',
  'reviews',
  'review_conflicts',
  'card_templates',
  'user_cards',
  'user_xp_profiles',
  'xp_transactions',
  'task_definitions',
  'user_task_progress',
  'certificates',
  'audit_logs',
  'reviewer_expertise',
  'reviewer_conflict_declarations',
  'raffles',
  'raffle_winners',
  /**
   * FASE 30 — rodadas de apuração. Cada momento do sorteio é uma linha aqui, com o
   * próprio compromisso, lista e resultado; a tabela nasce sob RLS como as demais.
   */
  'raffle_rounds',
  /**
   * FASE 31 — crachá do participante no evento. Um código opaco por par
   * (evento, pessoa): a presença continua sendo por (pessoa × atividade), em
   * `attendances`, e é o CONTEXTO da leitura que decide onde registrá-la.
   */
  'event_credentials',
  /**
   * FASE 32 — recado da instituição para um participante. Guarda o que ele vê na
   * caixa de entrada e o que saiu por e-mail (o vínculo com o outbox é a
   * `dedupeKey`, não uma coluna de referência). A `userId` é do DESTINATÁRIO: a
   * policy por instituição continua sendo o que impede uma instituição de ler o
   * recado da outra.
   */
  'participant_messages',
  /**
   * FASE 33 — chamada de propostas do evento. Cada chamada tem o próprio TIPO e a
   * própria JANELA (o minicurso fecha antes do artigo), e a proposta continua sendo
   * uma linha de `submissions` — que já está aqui. A `trackId` é opcional:
   * palestrante e minicurso não têm eixo temático.
   */
  'call_for_proposals',
  /**
   * FASE 15 — comunicação. As duas tabelas entram aqui mesmo com semânticas
   * diferentes: `email_messages` tem `tenantId` NULO nas mensagens de PLATAFORMA
   * (verificação de e-mail, redefinição de senha), e a policy faz exatamente o que
   * se espera — nenhuma instituição enxerga mensagem sem instituição. Quem as
   * escreve nesse caso é a conexão administrativa (BYPASSRLS), nunca o runtime.
   */
  'email_messages',
  'tenant_invitations',
];

/**
 * Tabelas globais de identidade. Não têm `tenantId` por decisão de arquitetura
 * (ADR-002) mas ainda assim recebem RLS com policies próprias.
 */
export const GLOBAL_TABLES_WITH_RLS = ['user', 'session', 'tenants'];

/**
 * Tabelas deliberadamente SEM RLS.
 *
 * `account` e `verification` pertencem ao fluxo de autenticação, que acontece
 * ANTES de existir tenant ativo. Aplicar RLS aqui quebraria o login sem ganho
 * de segurança: o acesso já é mediado por `identifier`/`userId`.
 */
export const TABLES_WITHOUT_RLS = ['account', 'verification'];

/** Todas as tabelas que devem ter `relrowsecurity = true`. */
export const EXPECTED_RLS_TABLES = [...TENANT_SCOPED_TABLES, ...GLOBAL_TABLES_WITH_RLS];
