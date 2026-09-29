/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Trilha de identidade (FASE 49)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  ONDE ESTA TRILHA É GRAVADA, E POR QUEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `identity_audit_logs` não tem `tenantId` e a role de runtime NÃO tem privilégio
 *  nela (`IDENTITY_ONLY_TABLES`): quem escreve e lê é a conexão de plataforma
 *  (`adminPrisma`), exatamente como `two_factor` e `job_runs`. Isso é decisão, não
 *  descuido: o fato é da CONTA, e não existe "instituição do fato" para a RLS
 *  comparar.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM GRAVA É O PONTO QUE CONHECE O ATO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A alternativa era um gancho genérico do adaptador (`user.update.after`), e ela é
 *  pior por dois motivos: auditoria de "algo mudou" não diz O QUÊ (e o que importa é
 *  "senha alterada", "2FA desligado", "sessões encerradas"), e um gancho de tabela
 *  registraria também o que não é segurança (trocar o nome, aceitar convite). Quem
 *  grava é a Server Action ou o gancho da biblioteca que SABE o que aconteceu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  NUNCA LANÇA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Registrar segurança não pode derrubar a operação que já deu certo: se a trilha
 *  falhar, o erro vai para o log e a troca de senha continua válida (o mesmo
 *  invariante da trilha de instituição). O que NÃO se aceita é o contrário: operação
 *  que falha e trilha que diz que aconteceu.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { randomUUID } from 'node:crypto';

import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import {
  IDENTITY_AUDIT_EVENTS,
  identityAuditTone,
  isIdentityAuditEvent,
  sanitizeIdentityDetails,
  type IdentityAuditEvent,
} from '@/domain/identity/identity-audit-rules';

export interface IdentityAuditInput {
  /** A conta afetada. `null` quando o fato não chegou a uma conta (e-mail inexistente). */
  userId?: string | null;
  /** Quem executou. Omitido quando foi a própria pessoa (o caso comum). */
  actorId?: string | null;
  event: IdentityAuditEvent;
  /** Estado alterado — o serviço sanitiza antes de gravar. */
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IdentityAuditEntry {
  id: string;
  userId: string | null;
  actorId: string | null;
  event: string;
  tone: ReturnType<typeof identityAuditTone>;
  details: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  /** Nome e e-mail MASCARADO de quem foi afetado (preenchidos na leitura). */
  subjectName: string | null;
  subjectEmailMasked: string | null;
}

export interface IdentityAuditFilters {
  userId?: string;
  event?: string;
  /** Busca por nome ou e-mail da pessoa afetada. */
  query?: string;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
}

export const IDENTITY_AUDIT_PAGE_SIZE = 25;

/** Mascara o endereço na LISTA (o completo não é necessário para investigar). */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '—';

  const visible = (local ?? '').slice(0, 1);
  return `${visible}***@${domain}`;
}

/**
 * Grava o fato. NUNCA lança.
 *
 * O `try` cobre a sanitização e o INSERT: um erro de trilha é registrado no log do
 * processo e a operação de segurança que o chamou segue com o resultado dela.
 */
export async function recordIdentityAudit(input: IdentityAuditInput): Promise<void> {
  try {
    const details = sanitizeIdentityDetails(input.details ?? {}) as object;

    await adminPrisma.identityAuditLog.create({
      data: {
        id: randomUUID(),
        userId: input.userId ?? null,
        actorId: input.actorId ?? null,
        event: input.event,
        details,
        ipAddress: input.ipAddress?.slice(0, 64) ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    console.error(`[identity-audit] falha ao registrar ${input.event}: ${errorMessage(error)}`);
  }
}

/**
 * Lê a trilha — para a tela do SuperAdmin (tudo) e para a tela da conta (só o que é
 * da própria pessoa, porque a posse é o próprio `userId`).
 */
export async function listIdentityAudit(
  filters: IdentityAuditFilters = {},
): Promise<{ entries: IdentityAuditEntry[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? IDENTITY_AUDIT_PAGE_SIZE), 100);

  try {
    /**
     * A busca por nome/e-mail da pessoa acontece em `user` (global): resolvemos os
     * ids ANTES de consultar a trilha, e não com um `join` — a tabela da trilha não
     * tem relação com `user` de propósito (a linha precisa sobreviver à conta).
     */
    let userIdsFilter: string[] | null = null;

    if (filters.query && filters.query.trim().length > 0) {
      const term = filters.query.trim();
      const users = await adminPrisma.user.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
        take: 200,
      });

      userIdsFilter = users.map((user) => user.id);

      if (userIdsFilter.length === 0) {
        return { entries: [], total: 0, page, totalPages: 0 };
      }
    }

    const event = filters.event && isIdentityAuditEvent(filters.event) ? filters.event : undefined;

    const where = {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(userIdsFilter ? { userId: { in: userIdsFilter } } : {}),
      ...(event ? { event } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      adminPrisma.identityAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      adminPrisma.identityAuditLog.count({ where }),
    ]);

    /** Nomes e e-mails vêm depois, e só dos ids que apareceram. */
    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => Boolean(id)))];
    const users =
      ids.length > 0
        ? await adminPrisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, email: true },
          })
        : [];

    const byId = new Map(users.map((user) => [user.id, user]));

    const entries: IdentityAuditEntry[] = rows.map((row) => {
      const subject = row.userId ? byId.get(row.userId) : undefined;

      return {
        id: row.id,
        userId: row.userId,
        actorId: row.actorId,
        event: row.event,
        tone: identityAuditTone(row.event),
        details: (row.details ?? {}) as Record<string, unknown>,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        createdAt: row.createdAt,
        subjectName: subject?.name ?? null,
        subjectEmailMasked: subject?.email ? maskEmail(subject.email) : null,
      };
    });

    return {
      entries,
      total,
      page,
      totalPages: Math.ceil(total / pageSize),
    };
  } catch (error) {
    console.error(`[identity-audit] falha ao ler a trilha: ${errorMessage(error)}`);
    return { entries: [], total: 0, page, totalPages: 0 };
  }
}

/** A lista da PRÓPRIA pessoa (tela de conta): por posse, sem filtro livre. */
export async function listMyIdentityAudit(input: {
  userId: string;
  limit?: number;
}): Promise<IdentityAuditEntry[]> {
  const rows = await listIdentityAudit({ userId: input.userId, page: 1, pageSize: input.limit ?? 10 });
  return rows.entries;
}

/**
 * Quantos fatos de cada tipo nas últimas N horas — o resumo do topo da auditoria.
 *
 * A janela é contada AQUI, e não na tela: `Date.now()` dentro do componente é leitura
 * impura no render (a mesma regra que barra `Math.random`), e a conta pertence ao
 * serviço de qualquer forma.
 */
export async function identityAuditSummary(input: { days: number }): Promise<Record<string, number>> {
  const since = new Date(Date.now() - input.days * 24 * 3_600_000);
  try {
    const grouped = await adminPrisma.identityAuditLog.groupBy({
      by: ['event'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const out: Record<string, number> = {};

    for (const row of grouped) {
      if (!isIdentityAuditEvent(row.event)) continue;
      out[row.event] = row._count._all;
    }

    return out;
  } catch (error) {
    console.error(`[identity-audit] falha ao resumir a trilha: ${errorMessage(error)}`);
    return {};
  }
}

/** Todos os eventos do catálogo — a tela usa para o filtro (e o teste, para varrer). */
export const ALL_IDENTITY_AUDIT_EVENTS = IDENTITY_AUDIT_EVENTS;
