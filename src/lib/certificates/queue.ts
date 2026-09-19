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

import { incCounter } from '@/lib/observability/metrics';
import { logger } from '@/lib/observability/logger';

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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O ID DO JOB NÃO PODE CONTER `:` (defeito corrigido na FASE 15)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este `jobId` era `certificate:<id>` desde a FASE 6, e o BullMQ RECUSA id
 *  customizado com dois segmentos separados por `:` (o `:` é o separador de chave no
 *  Redis): o `add` lançava "Custom Id cannot contain :", o `catch` daqui devolvia
 *  `false` e a emissão caía no caminho INLINE — funcionando, porém sem fila e sem
 *  ninguém perceber. Foi o teste de integração da fila de e-mails (FASE 15) que
 *  expôs o mesmo padrão aqui. O separador passou a ser hífen.
 */
export async function enqueueCertificate(
  data: CertificateJobData,
  options: { delayMs?: number } = {},
): Promise<boolean> {
  try {
    await getQueue().add('generate', data, {
      jobId: `certificate-${data.certificateId}`,
      ...(options.delayMs ? { delay: options.delayMs } : {}),
    });

    incCounter('certificate_jobs_enqueued_total');
    return true;
  } catch (error) {
    // Degradação consciente: não é erro fatal (o chamador gera inline), mas é
    // exatamente o evento que precisa aparecer em métrica e alerta — a fila caiu
    // e todo o trabalho passou a rodar dentro do processo web.
    incCounter('certificate_enqueue_degraded_total');
    logger.warn('fila de certificados indisponível; geração inline', {
      certificateId: data.certificateId,
      tenantId: data.tenantId,
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });
    return false;
  }
}

/**
 * Números da fila — usados pelo diagnóstico, pelo painel (FASE 7) e pelo scrape
 * de métricas (FASE 13).
 *
 * `workers` é a diferença entre "a fila existe" e "a fila anda": os contadores do
 * BullMQ continuam crescendo em `waiting` mesmo com o worker morto, então um
 * alerta baseado só no tamanho da fila demora a perceber a queda. O número de
 * workers registrados no Redis cai para zero imediatamente.
 */
export async function certificateQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  workers: number;
} | null> {
  try {
    const queue = getQueue();
    const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
    const workers = await queue.getWorkersCount();

    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      workers,
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
