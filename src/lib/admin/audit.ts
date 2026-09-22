/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Trilha de auditoria
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE A TRILHA É ESCRITA PELA APLICAÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `AuditLog` existe desde a modelagem da FASE 1 e ficou sem uso até aqui. Ele é
 *  gravado pelo CÓDIGO, e não por gatilhos do banco, por um motivo prático: o
 *  gatilho sabe o que mudou, mas não sabe QUEM pediu, de qual IP, nem qual era a
 *  intenção. Em uma plataforma multi-tenant, "quem" é a informação que decide se
 *  uma alteração foi legítima.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE NÃO VAI PARA A TRILHA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Senhas, tokens e segredos nunca são registrados. O diff guarda apenas campos de
 *  negócio — e o registro é feito em resumo (não o objeto inteiro), porque uma
 *  trilha que copia dados pessoais para outra tabela é um problema de privacidade,
 *  não uma solução de auditoria.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { adminPrisma } from '@/lib/db/admin-client';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';

/**
 * Ação auditada — espelha o enum `AuditAction` do schema.
 *
 * Redefinido aqui em vez de importado do cliente gerado, pela mesma razão das
 * outras camadas: a aplicação não depende do ORM para nomear seus conceitos, e o
 * tipo é estruturalmente idêntico ao do banco.
 */
export type AuditActionName =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGOUT'
  | 'EXPORT'
  /**
   * FASE 32 — leitura de dado pessoal agregado (a ficha do participante).
   *
   * A trilha nasceu sabendo registrar escrita. Consultar o histórico de uma pessoa é
   * um acesso que a instituição precisa poder conferir depois, e sem ação própria
   * esse acesso ficaria invisível.
   */
  | 'READ'
  | 'PERMISSION_CHANGE'
  | 'IMPERSONATE';

export interface AuditInput {
  /**
   * Instituição do fato. `null` = ação de PLATAFORMA (FASE 9): provisionar,
   * suspender ou reativar instituição não pertence a instituição alguma.
   */
  tenantId: string | null;
  userId?: string | null;
  action: AuditActionName;
  entityType: string;
  entityId?: string | null;
  /** Campos alterados: `{ campo: { de, para } }`. Nunca inclua segredos. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Grava uma entrada na trilha.
 *
 * Aceita um `tx` opcional para participar da MESMA transação da alteração: se a
 * alteração falhar, a trilha não registra um fato que não aconteceu. É o
 * comportamento correto — auditoria de evento inexistente é ruído que atrapalha
 * a investigação.
 *
 * Com `tenantId = null` a gravação usa a conexão administrativa — não por
 * conveniência, mas por necessidade: a policy de RLS compara `tenant_id` com o
 * contexto da transação, e uma linha com NULL é invisível para a role de runtime
 * (fail-closed). Esse é o MESMO caminho da leitura (ver `listPlatformAudit`), de
 * modo que a trilha de plataforma é escrita e lida pelo mesmo escopo.
 *
 * NUNCA lança: uma falha ao auditar não pode desfazer uma operação de negócio já
 * validada. O erro vai para o log do processo.
 */
export async function recordAudit(input: AuditInput, tx?: TxClient): Promise<void> {
  const data = {
    id: randomUUID(),
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    action: input.action,
    entityType: input.entityType.slice(0, 80),
    entityId: input.entityId ?? null,
    changes: sanitizeChanges(input.changes ?? {}) as unknown as object,
    ipAddress: input.ipAddress?.slice(0, 64) ?? null,
    userAgent: input.userAgent?.slice(0, 500) ?? null,
  };

  try {
    if (tx) {
      await tx.auditLog.create({ data });
      return;
    }

    if (input.tenantId === null) {
      await adminPrisma.auditLog.create({ data });
      return;
    }

    await withTenant(input.tenantId, (inner) => inner.auditLog.create({ data }));
  } catch (error) {
    console.error(`[audit] falha ao registrar ${input.action} ${input.entityType}: ${errorMessage(error)}`);
  }
}

/** Campos que jamais entram na trilha, mesmo que o chamador os envie. */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'token',
  'signature',
  'hmac',
  'apikey',
  'badgetoken',
]);

function sanitizeChanges(
  changes: Record<string, { from: unknown; to: unknown }>,
): Record<string, { from: unknown; to: unknown }> {
  const safe: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, value] of Object.entries(changes)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      safe[key] = { from: '[omitido]', to: '[omitido]' };
      continue;
    }

    safe[key] = { from: summarize(value.from), to: summarize(value.to) };
  }

  return safe;
}

/** Trunca valores longos: a trilha precisa ser legível e não virar um dump. */
function summarize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();

  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;

  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  changes: Record<string, { from: unknown; to: unknown }>;
  actorName: string | null;
  createdAt: Date;
}

/** Últimas entradas da trilha da instituição (para o painel). */
export async function listAuditLog(
  tenantId: string,
  options: { limit?: number } = {},
): Promise<AuditEntry[]> {
  try {
    const rows = await withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(1, options.limit ?? 30), 200),
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          changes: true,
          createdAt: true,
          user: { select: { name: true } },
        },
      }),
    );

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      changes: (row.changes as Record<string, { from: unknown; to: unknown }>) ?? {},
      actorName: row.user?.name ?? null,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error(`[audit] falha ao listar trilha: ${errorMessage(error)}`);
    return [];
  }
}

/** Compara dois objetos e devolve só os campos que mudaram. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of fields) {
    const from = before[field];
    const to = after[field];

    if (to === undefined) continue;

    const same =
      from instanceof Date && to instanceof Date
        ? from.getTime() === to.getTime()
        : JSON.stringify(from) === JSON.stringify(to);

    if (!same) changes[String(field)] = { from, to };
  }

  return changes;
}
