/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Entrypoint do worker de background
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ESTADO ATUAL (FASE 2)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O worker ainda NÃO processa filas: as filas reais (geração de certificados,
 *  envio de e-mails, distribuição de cards) chegam nas FASES 5 e 6.
 *
 *  O que ele já faz é o essencial para a FASE 2:
 *    • valida que o processo consegue falar com Redis e PostgreSQL;
 *    • expõe um ciclo de vida com shutdown gracioso (SIGTERM/SIGINT);
 *    • mantém o container vivo e saudável, para que o `depends_on` do compose
 *      tenha significado em vez de reiniciar em loop.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O WORKER EXISTE DESDE JÁ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Porque a partir da FASE 5 há trabalho que NÃO pode rodar no ciclo de uma
 *  requisição HTTP: gerar PDF de certificado leva segundos, e fazê-lo dentro de
 *  uma Server Action bloquearia o usuário. Ter o processo separado desde o
 *  início evita a refatoração de "depois a gente separa".
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { Redis } from 'ioredis';

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
    process.exit(1);
  }

  // O banco é validado aqui também: um worker sem banco não tem utilidade.
  const { withTenant, disconnectDb } = await import('@/lib/db/tenant-client');
  const { adminPrisma } = await import('@/lib/db/admin-client');

  try {
    await adminPrisma.$queryRaw`SELECT 1`;
    console.log('  ✓ PostgreSQL respondeu');
  } catch (error) {
    console.error(
      `  ✗ Não foi possível conectar ao PostgreSQL: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }

  console.log(
    `\n  Worker pronto. Nenhuma fila registrada ainda — as filas chegam nas FASES 5 e 6.`,
  );
  console.log(`${line}\n`);

  // ── Shutdown gracioso ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`\n  ${signal} recebido: encerrando com graciosidade...`);

    try {
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

  // Mantém o processo vivo aguardando trabalho. `withTenant` é referenciado para
  // garantir que o módulo (e a conexão de runtime com RLS) seja carregado e
  // validado agora, não no primeiro job.
  void withTenant;

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
