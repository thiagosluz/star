/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Fila e decisão da moderação do perfil público (FASE 56 · E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTE SERVIÇO USA A CONEXÃO DE PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A denúncia tem casa (nasce sob `withTenant`, com RLS e trilha), mas a MEDIDA é
 *  global: o `@handle` é o mesmo em todas as instituições. Se a leitura acontecesse
 *  sob o contexto de UMA casa, o `WHERE status = 'OPEN'` devolveria só as denúncias
 *  daquela — ou seja, uma resposta errada, e não uma negação (é exatamente o caso
 *  que `src/lib/platform/**` existe para atender; invariante nº 1).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A FILA LÊ O QUE ESTÁ ABERTO, DA MAIS ANTIGA PARA A MAIS NOVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ordem por `createdAt` crescente: fila de moderação é fila — quem esperou mais
 *  decide primeiro. E o resumo conta TODAS as abertas (não só as que couberam no
 *  `limit`): uma contagem que dependesse do tamanho da página diria "3" quando há
 *  300, e quem opera deixaria de ver trabalho acumulado.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { adminPrisma } from '@/lib/db/admin-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  HIDDEN_REASON_MAX_LENGTH,
  PROFILE_REPORT_CATEGORIES,
  canDecideReport,
  decisionNoteProblem,
  decisionNoteProblemMessage,
  isProfileModerationAction,
  profileModerationEffect,
  type ProfileModerationAction,
  type ProfileReportCategory,
  type ProfileReportStatus,
} from '@/domain/profile/profile-moderation-rules';

export type ProfileModerationErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_DECIDED'
  | 'INVALID_INPUT'
  | 'INTERNAL';

export type ProfileModerationResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ProfileModerationErrorCode; message: string; details?: readonly string[] };

export interface ModerationReportRow {
  reportId: string;
  createdAt: Date;
  category: ProfileReportCategory;
  details: string;
  status: ProfileReportStatus;
  /** O perfil denunciado — com o estado de ocultação, que é o efeito da medida. */
  reported: {
    userId: string;
    name: string;
    handle: string | null;
    isHidden: boolean;
    hiddenAt: Date | null;
  };
  reporter: { userId: string; name: string };
  /** Onde o perfil foi visto: a casa em que a denúncia nasceu. */
  origin: { tenantId: string; name: string; slug: string };
}

export interface ModerationSummary {
  total: number;
  byCategory: Record<ProfileReportCategory, number>;
}

export interface ModerationQueue {
  items: ModerationReportRow[];
  summary: ModerationSummary;
}

function emptySummary(): ModerationSummary {
  return {
    total: 0,
    byCategory: Object.fromEntries(PROFILE_REPORT_CATEGORIES.map((key) => [key, 0])) as Record<
      ProfileReportCategory,
      number
    >,
  };
}

/**
 * A fila de denúncias aguardando decisão.
 *
 * Devolve erro como VALOR (e não uma lista vazia) porque "nenhuma denúncia" e "não
 * consegui ler" são afirmações diferentes — e a segunda, mostrada como vazio, faria
 * a moderação acreditar que não há trabalho.
 */
export async function listModerationQueue(
  input: { limit?: number } = {},
): Promise<ProfileModerationResult<ModerationQueue>> {
  try {
    const [rows, grouped] = await Promise.all([
      adminPrisma.profileReport.findMany({
        where: { status: 'OPEN' },
        orderBy: { createdAt: 'asc' },
        take: Math.min(Math.max(1, input.limit ?? 100), 300),
        select: {
          id: true,
          createdAt: true,
          category: true,
          details: true,
          status: true,
          reportedUser: {
            select: {
              id: true,
              name: true,
              publicHandle: true,
              publicProfileHiddenAt: true,
            },
          },
          reporterUser: { select: { id: true, name: true } },
          tenant: { select: { id: true, name: true, slug: true } },
        },
      }),
      adminPrisma.profileReport.groupBy({
        by: ['category'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
    ]);

    const summary = emptySummary();

    for (const group of grouped) {
      const category = group.category as ProfileReportCategory;
      const count = group._count._all;
      summary.byCategory[category] = count;
      summary.total += count;
    }

    return {
      ok: true,
      items: rows.map((row) => ({
        reportId: row.id,
        createdAt: row.createdAt,
        category: row.category as ProfileReportCategory,
        details: row.details,
        status: row.status as ProfileReportStatus,
        reported: {
          userId: row.reportedUser.id,
          name: row.reportedUser.name,
          handle: row.reportedUser.publicHandle,
          isHidden: row.reportedUser.publicProfileHiddenAt !== null,
          hiddenAt: row.reportedUser.publicProfileHiddenAt,
        },
        reporter: { userId: row.reporterUser.id, name: row.reporterUser.name },
        origin: { tenantId: row.tenant.id, name: row.tenant.name, slug: row.tenant.slug },
      })),
      summary,
    };
  } catch (error) {
    console.error(`[moderacao] falha ao ler a fila de denúncias: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível carregar a fila de denúncias agora.',
    };
  }
}

/**
 * Quantas denúncias aguardam decisão.
 *
 * `null` é "não consegui contar" — e a tela mostra o atalho SEM número, porque
 * afirmar zero sem ter contado é pior do que não afirmar nada (a régua da FASE 54:
 * zero é uma contagem, `null` é a ausência dela).
 */
export async function countOpenReports(): Promise<number | null> {
  try {
    return await adminPrisma.profileReport.count({ where: { status: 'OPEN' } });
  } catch (error) {
    console.error(`[moderacao] falha ao contar as denúncias abertas: ${errorMessage(error)}`);
    return null;
  }
}

export interface DecideReportInput {
  reportId: string;
  action: ProfileModerationAction;
  /** Justificativa — obrigatória nos dois desfechos (mínimo no domínio). */
  note: string;
  /** Operador da plataforma. Vem da guarda, nunca do formulário. */
  actorId: string;
  now?: Date;
}

export interface DecideReportOutcome {
  reportId: string;
  status: Extract<ProfileReportStatus, 'DISMISSED' | 'ACTIONED'>;
  /** `true` quando a medida ocultou o perfil público. */
  hiddenProfile: boolean;
  effect: string;
}

/**
 * Decide uma denúncia.
 *
 * ─── A ESCRITA É CONDICIONAL, E É O BANCO QUE DECIDE ─────────────────────────
 *
 *  O `updateMany` filtra por `status = 'OPEN'`: se outra pessoa do time decidiu
 *  enquanto esta tela estava aberta, a atualização afeta 0 linhas e a resposta é
 *  `ALREADY_DECIDED` — nunca uma segunda decisão sobrescrevendo a primeira
 *  (invariante nº 5).
 *
 *  O efeito (`User.publicProfileHiddenAt`) entra na MESMA transação da decisão. Se
 *  o `update` do perfil falhasse depois de a denúncia ser marcada como `ACTIONED`, a
 *  fila diria "resolvido" com o perfil ainda no ar — o pior desfecho possível de
 *  uma moderação.
 *
 *  A TRILHA fica em `tenantId: null` porque o ato é da PLATAFORMA: a medida vale
 *  para todas as casas, e é em `/superadmin/auditoria` que ela precisa aparecer. A
 *  linha da denúncia continua com a casa em que nasceu.
 */
export async function decideReport(
  input: DecideReportInput,
): Promise<ProfileModerationResult<DecideReportOutcome>> {
  const noteProblem = decisionNoteProblem(input.note);

  if (noteProblem) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: decisionNoteProblemMessage(noteProblem),
    };
  }

  if (!isProfileModerationAction(input.action)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Decisão de moderação desconhecida.' };
  }

  const note = input.note.trim();
  const now = input.now ?? new Date();

  const report = await adminPrisma.profileReport.findUnique({
    where: { id: input.reportId },
    select: { id: true, status: true, reportedUserId: true },
  });

  if (!report) {
    return { ok: false, code: 'NOT_FOUND', message: 'Denúncia não encontrada.' };
  }

  if (!canDecideReport(report.status as ProfileReportStatus)) {
    return {
      ok: false,
      code: 'ALREADY_DECIDED',
      message: 'Esta denúncia já foi decidida. Recarregue a fila para ver o estado atual.',
    };
  }

  const status: DecideReportOutcome['status'] = input.action === 'HIDE' ? 'ACTIONED' : 'DISMISSED';

  try {
    const decided = await adminPrisma.$transaction(async (tx) => {
      const updated = await tx.profileReport.updateMany({
        where: { id: report.id, status: 'OPEN' },
        data: { status, decidedById: input.actorId, decidedAt: now, decisionNote: note },
      });

      if (updated.count === 0) return false;

      if (input.action === 'HIDE') {
        await tx.user.update({
          where: { id: report.reportedUserId },
          data: {
            publicProfileHiddenAt: now,
            /** Recorte da nota: a coluna do perfil é menor que a da decisão. */
            publicProfileHiddenReason: note.slice(0, HIDDEN_REASON_MAX_LENGTH),
          },
        });
      }

      return true;
    });

    if (!decided) {
      return {
        ok: false,
        code: 'ALREADY_DECIDED',
        message: 'Esta denúncia foi decidida por outra pessoa agora mesmo. Recarregue a fila.',
      };
    }
  } catch (error) {
    console.error(`[moderacao] falha ao decidir a denúncia: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível registrar a decisão agora. Nada foi alterado.',
    };
  }

  await recordAudit({
    tenantId: null,
    userId: input.actorId,
    action: 'UPDATE',
    entityType: 'profile_report',
    entityId: report.id,
    changes: {
      status: { from: report.status, to: status },
      perfilOcultado: { from: 'não', to: input.action === 'HIDE' ? 'sim' : 'não' },
      justificativa: { from: null, to: note },
    },
  });

  return {
    ok: true,
    reportId: report.id,
    status,
    hiddenProfile: input.action === 'HIDE',
    effect: profileModerationEffect(input.action),
  };
}
