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
 */
export const TENANT_SCOPED_TABLES = [
  'user_tenant_profiles',
  'role_assignments',
  'events',
  'rooms',
  'activities',
  'activity_speakers',
  'event_pages',
  'page_blocks',
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
