import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ESLint 9 — configuração "flat"
 *
 *  O `eslint-config-next` 16 já publica **flat config** (`Linter.Config[]`),
 *  então importamos diretamente. Não usamos `FlatCompat`: ele falha com
 *  "Converting circular structure to JSON" ao traduzir este preset, por causa
 *  das referências circulares entre os plugins do React.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const config = [
  {
    // Não lintamos artefatos gerados nem dependências.
    ignores: [
      '.next/**',
      'node_modules/**',
      'src/generated/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypescript,

  {
    rules: {
      // Permite parâmetros/variáveis intencionalmente não usados (prefixo `_`),
      // comum em assinaturas de teste e em stubs de fila.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
