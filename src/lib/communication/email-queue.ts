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
import { JOB_CATALOG } from '@/domain/platform/job-catalog';
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

/**
 * Nome do job repetível que cuida dos prazos de confirmação de vaga (FASE 34).
 *
 * Ele faz DUAS coisas na mesma passada, e de propósito:
 *
 *   • o LEMBRETE, para quem está a menos de um dia do vencimento;
 *   • a LIBERAÇÃO, para quem já venceu.
 *
 *  Separá-los em dois agendadores daria dois relógios para a mesma regra, e a
 *  primeira manutenção esqueceria um deles. A mesma passada que avisa é a que
 *  libera — e a ordem importa: quem está dentro do prazo é avisado, quem passou é
 *  liberado, e nenhuma inscrição recebe os dois tratamentos no mesmo minuto (o
 *  lembrete exige prazo FUTURO; a liberação, prazo vencido).
 */
export const CONFIRMATION_SWEEP_JOB = 'registration-confirmation-sweep';

/**
 * Cadência da confirmação de vaga.
 *
 * De hora em hora: o prazo vence no FIM DO DIA local, e o lembrete sai com 24 h de
 * antecedência — então a hora em que a passada roda não muda a decisão, só o quanto
 * antes a pessoa é avisada e por quanto tempo a vaga fica retida depois de vencida.
 * De 15 em 15 minutos (como as presenças) seria 96 varreduras por dia para prazos que
 * duram dias.
 */
export const CONFIRMATION_SWEEP_PATTERN = '0 * * * *';

/**
 * ─── Inspeção antivírus dos arquivos enviados (FASE 36) ───────────────────────
 *
 *  De 5 em 5 minutos: é o tempo que um arquivo recém-enviado fica invisível para o
 *  comitê quando a inspeção está ligada (o portão bloqueia `PENDING`). Cinco minutos
 *  é o meio-termo entre a espera de quem submeteu e o custo de varrer a tabela —
 *  a passada é limitada por lote, por instituição.
 */
export const FILE_SCAN_JOB = 'file-scan';
export const FILE_SCAN_PATTERN = JOB_CATALOG['file-scan'].pattern;

/**
 * ─── Manutenção das partições da auditoria (FASE 36) ──────────────────────────
 *
 *  Todo dia às 3h. A FASE 13 deixou isto para o cron do HOST; trazer para o worker
 *  remove a dependência de alguém configurar agendador na máquina — e o mês virando
 *  sem partição é o tipo de falha que só aparece quando alguém tenta auditar.
 *  Continua existindo a CLI (`npm run db:partitions`) para quem opera sem worker.
 */
export const AUDIT_PARTITIONS_JOB = 'audit-partitions';
export const AUDIT_PARTITIONS_PATTERN = JOB_CATALOG['audit-partitions'].pattern;

/** Todos os jobs repetíveis, com a cadência do catálogo — uma fonte só. */
export const SCHEDULED_JOBS = [
  { name: REVIEW_DEADLINES_JOB, pattern: REVIEW_DEADLINES_PATTERN },
  { name: ATTENDANCE_SWEEP_JOB, pattern: ATTENDANCE_SWEEP_PATTERN },
  { name: CONFIRMATION_SWEEP_JOB, pattern: CONFIRMATION_SWEEP_PATTERN },
  { name: FILE_SCAN_JOB, pattern: FILE_SCAN_PATTERN },
  { name: AUDIT_PARTITIONS_JOB, pattern: AUDIT_PARTITIONS_PATTERN },
] as const;

export interface EmailJobData {
  emailMessageId: string;
  /** NULO nas mensagens de plataforma (verificação, redefinição de senha). */
  tenantId: string | null;
  /**
   * FASE 36 — de onde veio a passada de uma ROTINA (`SCHEDULE` pelo relógio,
   * `MANUAL` pelo painel de governança, `CLI`). O registro em `job_runs` guarda
   * isto, e é o que responde "quem pediu esta execução?".
   */
  trigger?: string;
  /** Quem pediu pelo painel (nulo no relógio). */
  actorId?: string | null;
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

/**
 * Registra (uma vez) o job repetível da confirmação de vaga (FASE 34).
 *
 * Mesmo padrão dos outros dois: id FIXO, então reiniciar o worker reagenda em vez de
 * acumular varreduras — e subir dez workers não cria dez passadas.
 */
export async function scheduleConfirmationSweep(): Promise<boolean> {
  try {
    await getQueue().upsertJobScheduler(
      'registration-confirmation-sweep',
      { pattern: CONFIRMATION_SWEEP_PATTERN },
      { name: CONFIRMATION_SWEEP_JOB, data: { emailMessageId: '', tenantId: null } },
    );

    return true;
  } catch (error) {
    logger.warn('não foi possível agendar a varredura de confirmação de vaga', {
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });

    return false;
  }
}

/**
 * Registra (uma vez) os jobs repetíveis das rotinas automáticas.
 *
 * O id do agendador é FIXO por rotina (`upsertJobScheduler`): subir dez workers não
 * cria dez passadas, e reiniciar reagenda em vez de acumular. A lista sai do
 * catálogo (`SCHEDULED_JOBS`), então acrescentar uma rotina é acrescentar uma linha
 * lá — não há segunda lista para esquecer.
 */
export async function scheduleAutomationJobs(): Promise<{ scheduled: string[]; failed: string[] }> {
  const scheduled: string[] = [];
  const failed: string[] = [];

  for (const job of SCHEDULED_JOBS) {
    try {
      await getQueue().upsertJobScheduler(
        job.name,
        { pattern: job.pattern },
        { name: job.name, data: { emailMessageId: '', tenantId: null, trigger: 'SCHEDULE' } },
      );

      scheduled.push(job.name);
    } catch (error) {
      logger.warn(`não foi possível agendar a rotina ${job.name}`, {
        error: error instanceof Error ? error.message : 'erro desconhecido',
      });

      failed.push(job.name);
    }
  }

  return { scheduled, failed };
}

/**
 * Pede ao worker que rode uma rotina AGORA.
 *
 * ─── POR QUE A TELA NÃO RODA A ROTINA (FASE 36) ───────────────────────────────
 *  As varreduras são cross-tenant e passam por todas as instituições: executá-las
 *  dentro de uma requisição HTTP prenderia a resposta por minutos e daria ao
 *  processo web uma conexão de plataforma que ele não tem (a de runtime é sujeita a
 *  RLS por instituição). A tela ENFILEIRA; quem trabalha é o worker — a mesma
 *  divisão de sempre.
 *
 *  O `jobId` derivado do instante evita que dois cliques no mesmo segundo virem
 *  dois jobs (e, se virarem, o claim em `job_runs` ainda protege a rotina).
 */
export async function enqueueJobRun(input: {
  job: string;
  trigger?: string;
  actorId?: string | null;
}): Promise<boolean> {
  try {
    await getQueue().add(
      input.job,
      {
        emailMessageId: '',
        tenantId: null,
        trigger: input.trigger ?? 'MANUAL',
        actorId: input.actorId ?? null,
      },
      { jobId: `job-${input.job}-${Date.now()}` },
    );

    return true;
  } catch (error) {
    logger.warn('fila de rotinas indisponível', {
      job: input.job,
      error: error instanceof Error ? error.message : 'erro desconhecido',
    });

    return false;
  }
}

/** Números da fila (diagnóstico, métricas e painel). */export async function emailQueueStats(): Promise<{
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
