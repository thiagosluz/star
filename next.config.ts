import type { NextConfig } from 'next';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Configuração do Next.js 16
 *
 *  Decisões relevantes:
 *
 *  • output: 'standalone' — gera um servidor mínimo e autocontido em
 *    `.next/standalone`, sem precisar de node_modules completo na imagem final.
 *    É o que o `Dockerfile` (target `runner`) copia.
 *
 *  • serverExternalPackages — `pg` é um driver nativo de banco. Se o bundler
 *    tentar empacotá-lo, ele quebra em runtime. Prisma 7 com driver adapter
 *    depende dele.
 *
 *  • React Compiler habilitado — o React 19 traz o compilador que memoiza
 *    automaticamente os componentes, reduzindo re-render sem `useMemo` manual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const nextConfig: NextConfig = {
  output: 'standalone',

  reactStrictMode: true,
  reactCompiler: true,

  // Drivers de banco e clientes nativos não devem ser empacotados.
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],

  experimental: {
    // Server Actions recebem PDFs de submissão (FASE 4) — o limite padrão de
    // 1MB é insuficiente. O controle real de tamanho é feito na aplicação.
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },

  // Nota: a chave `eslint` foi removida do next.config.ts no Next.js 16.
  // O lint roda como etapa própria (`npm run lint`), não durante o build.

  typedRoutes: true,

  async headers() {
    return [
      {
        // Cabeçalhos de segurança aplicados a todas as rotas.
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=(self)',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
