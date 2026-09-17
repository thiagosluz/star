/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Cliente Prisma — ADMIN (role eventflow_admin)
 *
 *  DONO DO SCHEMA. Usada exclusivamente por:
 *    • CLI do Prisma (migrations, studio)
 *    • seed
 *    • scripts de verificação de contrato
 *    • Better Auth (ver nota abaixo)
 *    • `src/lib/platform/**` — governança da plataforma e diretório público
 *      (FASE 9). Ver a nota sobre operações globais ao final do arquivo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O BETTER AUTH USA A CONEXÃO ADMIN
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O fluxo de autenticação acontece ANTES de existir um tenant ativo — não há
 *  como definir `app.tenant_id`. Aplicar RLS aqui seria um impasse: o login
 *  precisa ler a tabela de sessão, mas a tabela exige um contexto que só existe
 *  depois do login.
 *
 *  Isso é seguro porque as tabelas que a biblioteca toca (`user`, `account`,
 *  `session`, `verification`) são globais por arquitetura (ADR-002) e não
 *  contêm dados de tenant. O isolamento entre instituições continua garantido
 *  pela RLS em todas as 27 tabelas de domínio.
 *
 *  Qualquer código de DOMÍNIO que use este cliente é um bug. Para isso existe
 *  `tenant-client.ts`.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A EXCEÇÃO DAS OPERAÇÕES GLOBAIS (FASE 9)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Governar instituições e medir a plataforma são operações que NÃO CABEM em um
 *  contexto de tenant: com `app.tenant_id` definido, o `COUNT` das outras
 *  instituições seria zero — a RLS devolveria uma resposta errada, não uma
 *  negação. O mesmo vale para a vitrine pública, que soma eventos abertos de
 *  todas as instituições.
 *
 *  Por isso `src/lib/platform/global-repository.ts` é o ÚNICO módulo de
 *  aplicação que usa este cliente, e ele:
 *    • declara campo a campo o que devolve (nada de `SELECT *`);
 *    • não expõe dado pessoal — a vitrine mostra o que a instituição publicou e
 *      as métricas são contagens;
 *    • nunca é alcançado sem passar por `requirePlatformPermission`.
 *
 *  O tráfego das instituições continua na role `eventflow_app`, sob RLS.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
/**
 * Import RELATIVO, não `@/generated/...`.
 *
 * O cliente do Prisma é o único módulo importado tanto pelo bundle do Next.js
 * quanto pelo module runner do Vitest. O alias `@/` é resolvido pelo bundler,
 * mas não pelo resolvedor do Vitest para módulos que ele externa — então este
 * import específico usa caminho relativo para funcionar nos dois contextos.
 */
import { PrismaClient } from '#db/prisma-client';

function buildAdminConnectionString(): string {
  const explicit = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (explicit) return explicit;

  const host = process.env.DB_HOST ?? 'localhost';
  const port = process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? '5432';
  const db = process.env.POSTGRES_DB ?? 'eventflow';
  const user = process.env.POSTGRES_USER ?? 'eventflow_admin';
  const pass = process.env.POSTGRES_PASSWORD ?? 'eventflow_dev_password';

  return `postgresql://${user}:${pass}@${host}:${port}/${db}?schema=public`;
}

/**
 * Em desenvolvimento o Next.js recarrega módulos a cada alteração. Sem o cache
 * no objeto global, cada reload criaria um pool novo e esgotaria as conexões
 * do PostgreSQL em poucos segundos.
 */
const globalForPrisma = globalThis as unknown as {
  __eventflowAdminPrisma?: PrismaClient;
};

function createAdminClient(): PrismaClient {
  const adapter = new PrismaPg(buildAdminConnectionString());
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const adminPrisma: PrismaClient =
  globalForPrisma.__eventflowAdminPrisma ?? createAdminClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__eventflowAdminPrisma = adminPrisma;
}

export type AdminPrismaClient = typeof adminPrisma;
