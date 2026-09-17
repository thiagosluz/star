/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Entrypoint do worker de background
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  FILA DE CERTIFICADOS (FASE 6)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O worker processa a fila `certificates`: renderiza o PDF/SVG, envia ao storage
 *  e marca o certificado como emitido. É o trabalho que NÃO pode rodar no ciclo de
 *  uma requisição HTTP (ver `src/lib/certificates/queue.ts`).
 *
 *  O que ele também faz, desde a FASE 2:
 *    • valida que o processo consegue falar com Redis e PostgreSQL;
 *    • expõe um ciclo de vida com shutdown gracioso (SIGTERM/SIGINT);
 *    • mantém o container vivo e saudável, para que o `depends_on` do compose
 *      tenha significado em vez de reiniciar em loop.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  CONTEXTO DE TENANT NO WORKER
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O job carrega `tenantId` no payload e cada operação abre a própria transação com
 *  `withTenant`. Não existe "worker global" lendo dados de todos os tenants: o
 *  paralelismo do BullMQ não pode virar brecha de isolamento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { Redis } from 'ioredis';
import { Worker, type Job } from 'bullmq';

import { logger } from '@/lib/observability/logger';

/**
 * Import de TIPO: apagado na compilação, portanto não arrasta o módulo da fila
 * (nem o `bullmq`) para dentro do bundle do worker antes de ser necessário.
 */
import type { CertificateJobData } from '@/lib/certificates/queue';

const line = '─'.repeat(78);

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);

console.log(`\n${line}\n  EVENTFLOW WORKER\n${line}`);
console.log(`  redis:       ${redisUrl}`);
console.log(`  concurrency: ${concurrency}`);
console.log(`  pid:         ${process.pid}\n`);

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // exigido pelo BullMQ
  lazyConnect: true,
});

let shuttingDown = false;

async function start(): Promise<void> {
  // ── Verificação de dependências ────────────────────────────────────────────
  try {
    await redis.connect();
    const pong = await redis.ping();
    console.log(`  ✓ Redis respondeu: ${pong}`);
  } catch (error) {
    // Falhar rápido e com mensagem clara é melhor que subir "saudável" e
    // descobrir o problema só quando o primeiro job for enfileirado.
    console.error(
      `  ✗ Não foi possível conectar ao Redis: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    logger.error('worker: Redis inacessível no start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const { disconnectDb } = await import('@/lib/db/tenant-client');
  const { adminPrisma } = await import('@/lib/db/admin-client');
  const { generateCertificate } = await import('@/lib/certificates/certificate-service');
  const { CERTIFICATE_QUEUE_NAME, redisConnection } = await import('@/lib/certificates/queue');

  // O banco é validado aqui também: um worker sem banco não tem utilidade.
  try {
    await adminPrisma.$queryRaw`SELECT 1`;
    console.log('  ✓ PostgreSQL respondeu');
  } catch (error) {
    console.error(
      `  ✗ Não foi possível conectar ao PostgreSQL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    logger.error('worker: PostgreSQL inacessível no start', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const { isSigningConfigured } = await import('@/lib/certificates/signer');
  if (!isSigningConfigured()) {
    /**
     * Sem segredo de assinatura, todo certificado sairia com assinatura vazia —
     * e um documento sem assinatura é indistinguível de um documento falso. O
     * worker avisa ALTO e continua vivo (a fila pode estar vazia), mas cada job
     * vai falhar com o motivo correto.
     */
    console.error(
      '  ⚠ CERTIFICATE_HMAC_SECRET ausente ou curto: a emissão de certificados vai falhar.',
    );
    logger.warn('worker: CERTIFICATE_HMAC_SECRET ausente ou curto', {
      consequence: 'toda emissão de certificado vai falhar',
    });
  }

  // ── Fila de certificados ───────────────────────────────────────────────────
  const worker = new Worker<CertificateJobData>(
    CERTIFICATE_QUEUE_NAME,
    async (job: Job<CertificateJobData>) => {
      const { tenantId, certificateId } = job.data;

      if (!tenantId || !certificateId) {
        throw new Error('Job inválido: tenantId e certificateId são obrigatórios.');
      }

      console.log(`  → gerando certificado ${certificateId} (tentativa ${job.attemptsMade + 1})`);
      logger.info('worker: gerando certificado', {
        certificateId,
        tenantId,
        attempt: job.attemptsMade + 1,
      });

      const result = await generateCertificate({ tenantId, certificateId });

      if (!result.ok) {
        // Lançar faz o BullMQ aplicar o backoff e contabilizar a falha — o motivo
        // fica gravado no próprio job e no certificado (`failureReason`).
        throw new Error(`[${result.code}] ${result.message}`);
      }

      console.log(`  ✓ certificado ${certificateId} emitido (${result.sizeBytes} bytes)`);
      logger.info('worker: certificado emitido', { certificateId, sizeBytes: result.sizeBytes });

      return { storageKey: result.storageKey, contentHash: result.contentHash };
    },
    {
      connection: redisConnection(),
      concurrency,
    },
  );

  worker.on('failed', (job, error) => {
    console.error(`  ✗ job ${job?.id ?? '?'} falhou: ${error.message}`);
    logger.error('worker: job de certificado falhou', {
      jobId: job?.id ?? null,
      certificateId: job?.data?.certificateId ?? null,
      tenantId: job?.data?.tenantId ?? undefined,
      attempt: (job?.attemptsMade ?? 0) + 1,
      error: error.message,
    });
  });

  worker.on('completed', (job) => {
    console.log(`  ✓ job ${job.id} concluído`);
    logger.info('worker: job de certificado concluído', {
      jobId: job.id ?? null,
      certificateId: job.data?.certificateId ?? null,
      tenantId: job.data?.tenantId ?? undefined,
      durationMs: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : null,
    });
  });

  console.log(`\n  Worker pronto. Fila "${CERTIFICATE_QUEUE_NAME}" registrada.`);
  console.log(`${line}\n`);

  // ── Shutdown gracioso ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n  ${signal} recebido: encerrando com graciosidade...`);

    try {
      // `close()` espera o job em andamento terminar: matar no meio deixaria um
      // certificado em GENERATING para sempre.
      await worker.close();
      await redis.quit();
      await disconnectDb();
      await adminPrisma.$disconnect();
    } catch {
      // Nada a fazer no encerramento.
    }

    console.log('  Worker encerrado.\n');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  setInterval(() => {
    // Heartbeat: confirma que Redis segue acessível. Um worker que perdeu o
    // broker precisa se reiniciar, não ficar "vivo" sem consumir nada.
    void redis.ping().catch(() => {
      console.error('  ✗ Redis inacessível no heartbeat. Encerrando para reinício.');
      process.exit(1);
    });
  }, 30_000);
}

start().catch((error) => {
  console.error(`  ✗ Falha ao iniciar o worker: ${error.message}`);
  process.exit(1);
});
