/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILA DE E-MAILS (BullMQ)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O ENVIO PASSA POR UMA FILA, SE ELE É RÁPIDO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Uma chamada ao Resend leva de 100 a 500 ms — e pode levar 10 s quando o provedor
 *  está degradado. No meio de uma Server Action isso é a diferença entre "cadastrei
 *  o convite" e "o navegador desistiu", e o retry do usuário cria um segundo
 *  convite. Na fila, a ação termina assim que a mensagem está REGISTRADA: o que
 *  resta é entrega, com backoff e sem ninguém esperando.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILA É OPCIONAL; O E-MAIL NÃO (mesma decisão da fila de certificados)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `enqueueEmailDelivery` devolve `false` quando o Redis não responde — e o
 *  chamador então entrega NA HORA, no próprio processo. Comunicação é funcionalidade
 *  do produto: uma indisponibilidade de infraestrutura não pode virar
 *  indisponibilidade de produto. O que se perde é a escala; o que se ganha é que o
 *  e-mail sai de qualquer maneira.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { Queue, type ConnectionOptions } from 'bullmq';

import { incCounter } from '@/lib/observability/metrics';
import { logger } from '@/lib/observability/logger';
import { redisConnection } from '@/lib/certificates/queue';

export const EMAIL_QUEUE_NAME = 'emails';

/** Nome do job repetível que varre prazos de parecer (D4). */
export const REVIEW_DEADLINES_JOB = 'review-deadlines';

/**
 * Cadência da varredura de prazos.
 *
 * De 6 em 6 horas: o aviso é "faltam 48 h", então uma janela de 6 h erra o alvo em
 * no máximo 6 h — e a idempotência por dia garante que rodar de novo não duplica
 * nada. De hora em hora seria mais preciso e gastaria 24 varreduras por dia para
 * avisar sobre prazos que duram dias.
 */
export const REVIEW_DEADLINES_PATTERN = '0 */6 * * *';

/**
 * Nome do job repetível que fecha as presenças abertas (FASE 31).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELE MORA NA MESMA FILA DOS E-MAILS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O nome `emails` ficou, mas esta é a fila de HOUSEKEEPING do processo: o worker faz
 *  a manutenção periódica aqui. O fechamento de presenças é uma consulta por
 *  varredura e não justifica uma terceira conexão, um terceiro worker e um terceiro
 *  agendador — o que justifica é o relógio que já existe. Se a fila ganhar outro
 *  dono, ela deve ser renomeada.
 */
export const ATTENDANCE_SWEEP_JOB = 'attendance-sweep';

/**
 * Cadência do fechamento automático das presenças.
 *
 *  De 15 em 15 minutos: quem esqueceu de registrar a saída recebe a saída no FIM DA
 *  ATIVIDADE (o número não depende de quando a varredura roda), então a cadência só
 *  decide quanto tempo o painel mostra uma sessão aberta que já acabou.
 */
export const ATTENDANCE_SWEEP_PATTERN = '*/15 * * * *';

export interface EmailJobData {
  emailMessageId: string;
  /** NULO nas mensagens de plataforma (verificação, redefinição de senha). */
  tenantId: string | null;
}

let queue: Queue<EmailJobData> | null = null;

function getQueue(): Queue<EmailJobData> {
  if (!queue) {
    queue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
      connection: redisConnection() as ConnectionOptions,
      defaultJobOptions: {
        /**
         * Cinco tentativas com backoff exponencial: e-mail é mais tolerante a
         * espera que certificado (ninguém está olhando a tela), e provedor de
         * e-mail tem limite de taxa — insistir rápido piora.
         */
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 500 },
      },
    });
  }

  return queue;
}

/**
 * Enfileira a entrega. O `jobId` é o id da mensagem: enfileirar duas vezes não cria
 * duas entregas — a mesma idempotência do outbox, estendida à fila.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  O ID DO JOB NÃO PODE CONTER `:` (armadilha 49)
 * ─────────────────────────────────────────────────────────────────────────────
 *  O BullMQ reserva `:` como separador de chave no Redis e RECUSA um `jobId`
 *  customizado com dois segmentos (`email:<uuid>`): o `add` lança "Custom Id cannot
 *  contain :". O sintoma é enganoso — o `enqueue` devolve `false`, o chamador acha
 *  que a fila caiu e entrega INLINE, e tudo funciona devagar para sempre. Por isso o
 *  separador aqui é hífen.
 */
export async function enqueueEmailDelivery(data: EmailJobData): Promise<boolean> {
  try {
    await getQueue().add('deliver', data, { jobId: `email-${data.emailMessageId}` });

    incCounter('email_jobs_enqueued_total');
    return true;
  } catch (error) {
    incCounter('email_enqueue_degraded_total');
    logger.warn('fila de e-mails indisponível; entrega inline', {
      emailMessageId: data.emailMessageId,
      tenantId: data.tenantId ?? undefined,
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });
    return false;
  }
}

/**
 * Registra (uma vez) o job repetível que varre prazos de parecer.
 *
 * `upsertJobScheduler` com id FIXO substitui o agendamento em vez de acumular
 * cópias a cada start do worker — subir dez vezes não cria dez varreduras. É a API
 * do BullMQ 6: o `repeat` por job saiu do `add` e passou a ser um agendador nomeado.
 */
export async function scheduleReviewDeadlineScan(): Promise<boolean> {
  try {
    await getQueue().upsertJobScheduler(
      'review-deadlines',
      { pattern: REVIEW_DEADLINES_PATTERN },
      { name: REVIEW_DEADLINES_JOB, data: { emailMessageId: '', tenantId: null } },
    );

    return true;
  } catch (error) {
    logger.warn('não foi possível agendar a varredura de prazos de parecer', {
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });
    return false;
  }
}

/**
 * Registra (uma vez) o job repetível que fecha as presenças abertas.
 *
 * Mesmo padrão do agendamento de prazos: id FIXO, então reiniciar o worker reagenda
 * em vez de acumular varreduras.
 */
export async function scheduleAttendanceSweep(): Promise<boolean> {
  try {
    await getQueue().upsertJobScheduler(
      'attendance-sweep',
      { pattern: ATTENDANCE_SWEEP_PATTERN },
      { name: ATTENDANCE_SWEEP_JOB, data: { emailMessageId: '', tenantId: null } },
    );

    return true;
  } catch (error) {
    logger.warn('não foi possível agendar o fechamento de presenças', {
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });

    return false;
  }
}

/** Números da fila (diagnóstico, métricas e painel). */
export async function emailQueueStats(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  workers: number;
} | null> {
  try {
    const instance = getQueue();
    const counts = await instance.getJobCounts('waiting', 'active', 'completed', 'failed');
    const workers = await instance.getWorkersCount();

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
export async function closeEmailQueue(): Promise<void> {
  if (!queue) return;

  await queue.close();
  queue = null;
}
