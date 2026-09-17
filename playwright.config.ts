import { defineConfig, devices } from '@playwright/test';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Configuração do Playwright (E2E)
 *
 *  Os testes sobem um usuário REAL, fazem login pela interface e exercitam a
 *  troca de contexto — que é o comportamento mais difícil de validar sem
 *  navegador, porque envolve cookie assinado, redirecionamento e re-render.
 *
 *  O servidor é iniciado automaticamente (`webServer`), a menos que já esteja
 *  rodando em `E2E_BASE_URL`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './test-results',

  fullyParallel: false,
  workers: 1,

  // Uma falha intermitente não deve mascarar um bug real.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'pt-BR',
    timezoneId: 'America/Bahia',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
