import 'dotenv/config'
import path from 'node:path'
import { defineConfig } from 'prisma/config'

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Configuração do Prisma 7
 *
 *  Prisma 7: a connection string NÃO vive mais no `schema.prisma`.
 *
 *  - `datasource.url` é usada **apenas pela CLI** (migrate / studio / db push).
 *  - Em runtime a aplicação injeta a conexão via **driver adapter**
 *    (`@prisma/adapter-pg`), o que nos permite controlar o
 *    `SET LOCAL app.tenant_id` por transação.
 *
 *  A CLI usa a role ADMIN (`eventflow_admin`, dona do schema), porque migrações
 *  precisam enxergar e alterar todas as tabelas.
 *  A aplicação usa a role de runtime `eventflow_app`, sujeita a RLS.
 *
 *  NOTA: `datasource` é omitido quando a variável não existe. Isso é
 *  intencional — o `next build` roda `prisma generate`, e `generate` não precisa
 *  de banco. Sem essa omissão, uma imagem Docker (que não recebe `.env`)
 *  falharia no build por uma variável que só é necessária em `migrate`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const migrateUrl = process.env.MIGRATE_DATABASE_URL

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  ...(migrateUrl ? { datasource: { url: migrateUrl } } : {}),
})
