/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Fila de certificados (BullMQ)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A GERAÇÃO NÃO ACONTECE NA REQUISIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Renderizar PDF + QR, subir dois objetos no storage e atualizar o banco leva
 *  centenas de milissegundos por certificado. Em um evento com 300 participantes,
 *  emitir em lote dentro de uma Server Action significaria uma requisição de
 *  minutos — que estoura o timeout, e cujo retry reemite tudo de novo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILA É OPCIONAL; A EMISSÃO NÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `enqueueCertificate` devolve `false` quando o Redis não está acessível — e o
 *  chamador então gera o certificado NA HORA, no próprio processo. Gamificação e
 *  certificado são funcionalidades do produto; depender de um broker externo para
 *  que elas funcionem transformaria uma indisponibilidade de infraestrutura em
 *  indisponibilidade de produto.
 *
 *  O que se perde na geração inline é a ESCALA (o trabalho ocupa o processo web);
 *  o que se ganha é que o certificado sai de qualquer maneira.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Queue, type ConnectionOptions } from 'bullmq';

export const CERTIFICATE_QUEUE_NAME = 'certificates';

export interface CertificateJobData {
  tenantId: string;
  certificateId: string;
  /** Quem pediu — vai para o log do job. */
  actorId?: string | null;
}

/** Opções de conexão do BullMQ (exige `maxRetriesPerRequest: null`). */
export function redisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  return {
    // O BullMQ aceita uma URL e cria a conexão internamente, mas passar o objeto
    // evita duplicar configuração entre queue e worker.
    host: safeHost(url),
    port: safePort(url),
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'localhost';
  }
}

function safePort(url: string): number {
  try {
    return Number(new URL(url).port || 6379);
  } catch {
    return 6379;
  }
}

let queue: Queue<CertificateJobData> | null = null;

function getQueue(): Queue<CertificateJobData> {
  if (!queue) {
    queue = new Queue<CertificateJobData>(CERTIFICATE_QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        /**
         * Três tentativas com backoff exponencial.
         *
         * Falha de storage é tipicamente transitória; falha de dado (certificado
         * inexistente, por exemplo) não melhora com retry, mas é barata e o job
         * termina marcado como falho com o motivo gravado no banco.
         */
        attempts: 3,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 500 },
      },
    });
  }

  return queue;
}

/**
 * Enfileira a geração. Devolve `false` se o Redis não responder.
 *
 * O `jobId` é o id do certificado: enfileirar duas vezes o mesmo certificado
 * sobrescreve o job em vez de criar um segundo — a mesma garantia de idempotência
 * do banco, estendida à fila.
 */
export async function enqueueCertificate(
  data: CertificateJobData,
  options: { delayMs?: number } = {},
): Promise<boolean> {
  try {
    await getQueue().add('generate', data, {
      jobId: `certificate:${data.certificateId}`,
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });

    return true;
  } catch (error) {
    console.error(
      `[certificates] fila indisponível (${error instanceof Error ? error.message : 'erro'}); gerando inline.`,
    );
    return false;
  }
}

/** Números da fila — usados pelo diagnóstico e pelo painel (FASE 7). */
export async function certificateQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
} | null> {
  try {
    const counts = await getQueue().getJobCounts('waiting', 'active', 'completed', 'failed');

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
    };
  } catch {
    return null;
  }
}

/** Encerra a conexão da fila (shutdown gracioso e testes). */
export async function closeCertificateQueue(): Promise<void> {
  if (!queue) return;

  await queue.close();
  queue = null;
}
