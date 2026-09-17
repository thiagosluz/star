/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  E2E — operação e segurança (FASE 13)
 *
 *  Este arquivo roda contra o container do docker-compose, que é o único lugar
 *  onde `NODE_ENV=production` DE VERDADE. É por isso que a verificação do endpoint
 *  de métricas vive aqui e não no Vitest: em produção, sem `METRICS_TOKEN`, o
 *  endpoint precisa responder 404 — não 401, não 200, e principalmente não
 *  "existe mas está vazio".
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE 404 E NÃO 401
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Um 401 confirma a existência da rota e convida a tentar tokens. Um 404 diz que
 *  ali não há nada — a mesma resposta que uma URL inventada. Métricas expõem
 *  topologia, volume de tráfego e nome de rota: enquanto o operador não define o
 *  token, o endpoint não deve existir para quem sonda.
 *
 *  O caminho AUTORIZADO (com token) é verificado no Vitest, que chama o handler
 *  com `METRICS_TOKEN` definido, e manualmente com o comando documentado na fase:
 *  `docker compose run --rm -e METRICS_TOKEN=... -p 3010:3000 web`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { expect, test } from '@playwright/test';

test.describe('endpoint de métricas em produção', () => {
  test('responde 404 quando METRICS_TOKEN não está configurado', async ({ request }) => {
    const response = await request.get('/api/metrics');

    expect(response.status()).toBe(404);
  });

  test('não responde métricas nem com token inventado', async ({ request }) => {
    const response = await request.get('/api/metrics?token=token-inventado', {
      headers: { authorization: 'Bearer token-inventado' },
    });

    expect(response.status()).toBe(404);
    expect(await response.text()).toBe('not found\n');
  });

  test('a rota de saúde segue pública (a métrica não pode quebrar o probe)', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.ok()).toBe(true);
  });
});
