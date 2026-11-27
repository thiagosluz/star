import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Configuração do Vitest
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  SOBRE OS CAMINHOS DE IMPORT (`@/` vs relativo)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Os testes importam a aplicação por caminho RELATIVO (`../../src/...`).
 *
 *  Motivo: o Vitest resolve os módulos dos arquivos de TESTE por conta própria
 *  (module runner), e nem `resolve.alias` nem o `resolve.tsconfigPaths` do
 *  Vite 8 chegam até esse resolvedor — o resultado era
 *  `Cannot find package '@/domain/...'`.
 *
 *  Já os módulos de `src/` SÃO processados pelo Vite (forçados via
 *  `server.deps.inline` abaixo), então dentro deles o alias `@/` funciona
 *  normalmente. Sem o `inline`, o Vitest externaliza esses arquivos para o
 *  loader nativo do Node, que não conhece o alias — e o erro reaparece.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default defineConfig(({ mode }) => ({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },

  test: {
    environment: 'node',
    globals: true,
    exclude: ['node_modules', '.next', 'tests/e2e/**'],

    // Carrega o .env para os testes de integração que falam com o banco real.
    env: loadEnv(mode, process.cwd(), ''),

    server: {
      deps: {
        // Processa TODO o código-fonte da aplicação pelo Vite, em vez de
        // delegar ao Node. É o que faz o alias `@/` funcionar dentro de `src/`.
        inline: [/src\//],
      },
    },

    testTimeout: 30_000,
    hookTimeout: 30_000,

    // FASE 130: unitários puros rodam em paralelo entre arquivos (`test:unit`);
    // integração permanece sequencial (`fileParallelism: false`) porque compartilha
    // o mesmo banco real. `npm test` (`vitest run`) continua rodando ambos.
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          fileParallelism: true,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          fileParallelism: false,
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/domain/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['src/generated/**'],
    },
  },
}))
