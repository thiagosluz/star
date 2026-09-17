/**
 * Endpoint de métricas no formato Prometheus (text/plain; version=0.0.4).
 *
 * Por que existe: sem uma superfície de leitura, os contadores do processo são
 * apenas números em memória. Prometheus/Grafana consomem este endpoint; o
 * painel interno continua sendo o `/superadmin/observabilidade`.
 *
 * Segurança: métricas expõem topologia e volume de tráfego, então o endpoint
 * é fechado por padrão. Ele só responde quando `METRICS_TOKEN` está definido e
 * o cliente envia `Authorization: Bearer <token>` OU `?token=<token>`. Sem a
 * variável, respondemos 404 em produção (não revelamos a existência da rota) e
 * 200 fora de produção, para que o desenvolvimento local e a suíte E2E possam
 * inspecionar as métricas sem configuração extra.
 *
 * O diretório `/api` está fora do matcher do proxy, portanto não há tenant no
 * contexto: nada aqui pode tocar o banco sob RLS.
 */

import { NextResponse } from 'next/server';

import { certificateQueueStats } from '@/lib/certificates/queue';
import { incCounter, renderMetrics, setGauge } from '@/lib/observability/metrics';

export const dynamic = 'force-dynamic';
// O runtime do worker de fila precisa de Node (ioredis/BullMQ, não Edge).
export const runtime = 'nodejs';

/**
 * Compara o token recebido com `METRICS_TOKEN` sem vazar o tamanho por tempo.
 * Chamadas de token são raras (scrape a cada 15s), então a comparação lenta é
 * irrelevante e evita `===` de string.
 */
function tokenMatches(received: string | null, expected: string): boolean {
  if (!received || received.length !== expected.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= received.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return diff === 0;
}

/** Extrai o token do header `Authorization: Bearer` ou da query `?token=`. */
function readToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) {
    return header.slice('bearer '.length).trim();
  }
  return new URL(request.url).searchParams.get('token');
}

export async function GET(request: Request): Promise<Response> {
  const expectedToken = process.env.METRICS_TOKEN?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (expectedToken) {
    if (!tokenMatches(readToken(request), expectedToken)) {
      incCounter('metrics_scrape_denied_total');
      return new NextResponse('unauthorized\n', {
        status: 401,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  } else if (isProduction) {
    // Fail-closed: em produção o endpoint é invisível até o operador definir
    // METRICS_TOKEN. 404 (e não 403) para não anunciar que a rota existe.
    return new NextResponse('not found\n', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  // Gauges de fila são coletados no scrape: BullMQ é a fonte da verdade e o
  // custo de um `getJobCounts` a cada 15s é desprezível. Falha de Redis não
  // pode derrubar o scrape (mesmo princípio do rate limit: degradar, não cair).
  // `certificateQueueStats()` devolve `null` (em vez de lançar) quando o Redis
  // não responde; os dois casos degradam para `bullmq_queue_up 0`, que é o sinal
  // que o alerta observa, sem invalidar o resto do scrape.
  const stats = await certificateQueueStats().catch(() => null);

  if (stats) {
    setGauge('bullmq_queue_jobs', stats.waiting, { queue: 'certificates', state: 'waiting' });
    setGauge('bullmq_queue_jobs', stats.active, { queue: 'certificates', state: 'active' });
    setGauge('bullmq_queue_jobs', stats.completed, { queue: 'certificates', state: 'completed' });
    setGauge('bullmq_queue_jobs', stats.failed, { queue: 'certificates', state: 'failed' });
    setGauge('bullmq_queue_workers', stats.workers, { queue: 'certificates' });
    setGauge('bullmq_queue_up', 1, { queue: 'certificates' });
  } else {
    setGauge('bullmq_queue_up', 0, { queue: 'certificates' });
    incCounter('bullmq_queue_stats_failed_total');
  }

  incCounter('metrics_scrapes_total');

  return new NextResponse(renderMetrics(), {
    status: 200,
    headers: {
      'content-type': 'text/plain; version=0.0.4; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
