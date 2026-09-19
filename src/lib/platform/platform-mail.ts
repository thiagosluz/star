/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  OUTBOX DE PLATAFORMA — e-mail que não pertence a instituição nenhuma
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE ARQUIVO EXISTE (E FICA AQUI, EM `src/lib/platform/**`)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Confirmação de e-mail e redefinição de senha acontecem ANTES de existir
 *  instituição no contexto: quem clica no link pode não ter vínculo com ninguém. A
 *  linha em `email_messages` fica com `tenantId` NULO — e a policy de RLS, sozinha,
 *  torna essa linha invisível para qualquer instituição (o que é o comportamento
 *  correto: mensagem de plataforma não é dado de cliente).
 *
 *  Só que a role de RUNTIME não consegue escrever nem ler essa linha: ela precisa
 *  de contexto, e não há contexto a usar. É exatamente o caso previsto no invariante
 *  nº 1 — operação GLOBAL que, sob o contexto de UMA instituição, devolveria zero
 *  linhas em vez de negar. Por isso a escrita mora aqui, com a conexão
 *  administrativa, no mesmo diretório (e sob a mesma regra) da governança.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import type { EmailStatus } from '@/generated/prisma/enums';

export interface PlatformEmailInput {
  to: string;
  toUserId: string | null;
  template: string;
  subject: string;
  payload: Record<string, unknown>;
  html: string;
  text: string;
  dedupeKey: string | null;
}

/** Grava a mensagem de plataforma no outbox. Devolve o id criado. */
export async function createPlatformEmail(input: PlatformEmailInput): Promise<string> {
  const id = crypto.randomUUID();

  await adminPrisma.emailMessage.create({
    data: {
      id,
      tenantId: null,
      to: input.to,
      toUserId: input.toUserId,
      template: input.template,
      subject: input.subject,
      payload: input.payload as unknown as object,
      html: input.html,
      text: input.text,
      status: 'QUEUED',
      dedupeKey: input.dedupeKey,
    },
  });

  return id;
}

/** Lê a mensagem pelo id, sem contexto de tenant (só faz sentido para as de plataforma). */
export async function findPlatformEmail(id: string): Promise<{
  id: string;
  tenantId: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  status: EmailStatus;
  attempts: number;
} | null> {
  return adminPrisma.emailMessage.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      to: true,
      subject: true,
      html: true,
      text: true,
      status: true,
      attempts: true,
    },
  });
}

/** Atualiza o estado de entrega da mensagem de plataforma. */
export async function updatePlatformEmail(
  id: string,
  data: {
    status?: EmailStatus;
    driver?: string | null;
    providerId?: string | null;
    error?: string | null;
    sentAt?: Date | null;
    attempts?: number;
  },
): Promise<void> {
  await adminPrisma.emailMessage.update({ where: { id }, data });
}

/**
 * Mensagens de plataforma recentes de um endereço — usado pelo teste de integração
 * e pelo diagnóstico de "o e-mail de verificação saiu?".
 */
export async function listPlatformEmailsByRecipient(
  email: string,
  limit = 10,
): Promise<{ id: string; template: string; subject: string; status: EmailStatus; createdAt: Date }[]> {
  return adminPrisma.emailMessage.findMany({
    where: { to: email, tenantId: null },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, template: true, subject: true, status: true, createdAt: true },
  });
}
