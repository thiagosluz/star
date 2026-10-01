/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Denúncia do perfil público (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A DENÚNCIA NASCE SOB RLS; A DECISÃO É DE PLATAFORMA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Este serviço só CRIA e LÊ o que a pessoa denunciou. A fila e a decisão vivem em
 *  `src/lib/platform/profile-moderation.ts`, pelo `adminPrisma` — porque o `@handle`
 *  é global e a medida vale para todas as casas (ver o comentário do modelo).
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A NORMALIZAÇÃO DO `@handle` É A MESMA DA PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `getPublicProfile` procura por `publicHandle` com `trim().toLowerCase()` porque o
 *  índice único é sobre `lower("publicHandle")`. Repetir a régua aqui de forma
 *  diferente seria pior do que não conferir: a página acharia o perfil e a denúncia
 *  responderia "não existe" — ou, no sentido inverso, uma denúncia apontaria para um
 *  handle que a tela nunca mostrou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O SERVIÇO CONFERE O PERTENCIMENTO À INSTITUIÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página pública de um `@handle` só existe onde a PESSOA participa (vínculo ou
 *  inscrição); fora dali ela responde 404. Aceitar denúncia contra um perfil que não
 *  existe nesta casa encheria a fila de relatos sobre uma página que ninguém viu —
 *  e quem triagem não teria como distinguir isso de um relato legítimo. A régua é a
 *  MESMA da página, de propósito.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import { errorMessage } from '@/lib/db/prisma-errors';
import { recordAudit } from '@/lib/admin/audit';
import {
  detailsProblem,
  detailsProblemMessage,
  isProfileReportCategory,
  type ProfileReportCategory,
  type ProfileReportStatus,
} from '@/domain/profile/profile-moderation-rules';

export type ProfileReportErrorCode =
  | 'NOT_FOUND'
  | 'SELF_REPORT'
  | 'ALREADY_REPORTED'
  | 'INVALID_INPUT'
  | 'INTERNAL';

export type ProfileReportResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: ProfileReportErrorCode; message: string; details?: readonly string[] };

export interface ReportPublicProfileInput {
  tenantId: string;
  /** Quem denuncia. Vem da SESSÃO, nunca de um campo do formulário. */
  reporterUserId: string;
  /** `@handle` cru — o serviço normaliza como a página pública faz. */
  username: string;
  category: ProfileReportCategory;
  details: string | null;
  ipAddress?: string | null;
}

/**
 * Registra a denúncia.
 *
 * A ORDEM das recusas é contrato: primeiro o handle existe?, depois é o próprio
 * perfil?, depois a forma do relato, e só então a duplicidade — que é a única que
 * exige olhar o histórico. Negar por "já denunciou" um perfil inexistente daria uma
 * mensagem sobre a coisa errada.
 */
export async function reportPublicProfile(
  input: ReportPublicProfileInput,
): Promise<ProfileReportResult<{ reportId: string }>> {
  if (!isProfileReportCategory(input.category)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'Escolha uma categoria de denúncia.' };
  }

  const problem = detailsProblem(input.category, input.details);

  if (problem) {
    return { ok: false, code: 'INVALID_INPUT', message: detailsProblemMessage(problem) };
  }

  const normalized = input.username.trim().toLowerCase();

  if (normalized.length === 0) {
    return { ok: false, code: 'NOT_FOUND', message: 'Perfil não encontrado.' };
  }

  const details = (input.details ?? '').trim();

  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const person = await tx.user.findFirst({
        where: { publicHandle: normalized, deletedAt: null },
        select: { id: true, publicHandle: true },
      });

      if (!person?.publicHandle) return { kind: 'not-found' } as const;

      if (person.id === input.reporterUserId) return { kind: 'self-report' } as const;

      /** A mesma régua de `evaluatePublicProfile`: a página existe onde a pessoa participa. */
      const [membership, registration] = await Promise.all([
        tx.userTenantProfile.findFirst({
          where: {
            tenantId: input.tenantId,
            userId: person.id,
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: { id: true },
        }),
        tx.registration.findFirst({
          where: { tenantId: input.tenantId, userId: person.id, deletedAt: null },
          select: { id: true },
        }),
      ]);

      if (!membership && !registration) return { kind: 'not-found' } as const;

      /**
       * UMA denúncia ABERTA por denunciante e por perfil.
       *
       * A checagem é no serviço (e não só na tela) porque uma Server Action é um
       * endpoint HTTP: repetir o envio do formulário não pode multiplicar a fila. É
       * aqui — e não num índice único — porque a regra é sobre a denúncia ABERTA: a
       * mesma pessoa precisa poder denunciar de novo depois de uma decisão.
       */
      const open = await tx.profileReport.findFirst({
        where: {
          tenantId: input.tenantId,
          reporterUserId: input.reporterUserId,
          reportedUserId: person.id,
          status: 'OPEN',
        },
        select: { id: true },
      });

      if (open) return { kind: 'already-reported' } as const;

      const report = await tx.profileReport.create({
        data: {
          tenantId: input.tenantId,
          reportedUserId: person.id,
          reporterUserId: input.reporterUserId,
          category: input.category,
          details,
          status: 'OPEN',
        },
        select: { id: true },
      });

      /**
       * A TRILHA guarda o ATO, não o relato inteiro.
       *
       * O que interessa a quem audita é "quem denunciou qual perfil, sob que
       * categoria e quando". Copiar o texto da denúncia para a auditoria só
       * multiplicaria dado pessoal em outra tabela (a mesma régua da FASE 44, que
       * não copia a bio).
       */
      await recordAudit(
        {
          tenantId: input.tenantId,
          userId: input.reporterUserId,
          action: 'CREATE',
          entityType: 'profile_report',
          entityId: report.id,
          changes: {
            perfil: { from: null, to: `@${person.publicHandle}` },
            categoria: { from: null, to: input.category },
            detalhes: { from: null, to: details.length > 0 ? 'informados' : 'não informados' },
          },
          ipAddress: input.ipAddress ?? null,
        },
        tx,
      );

      return { kind: 'created' as const, reportId: report.id };
    });

    if (outcome.kind === 'not-found') {
      return { ok: false, code: 'NOT_FOUND', message: 'Perfil não encontrado.' };
    }

    if (outcome.kind === 'self-report') {
      return { ok: false, code: 'SELF_REPORT', message: 'Você não pode denunciar o seu próprio perfil.' };
    }

    if (outcome.kind === 'already-reported') {
      return {
        ok: false,
        code: 'ALREADY_REPORTED',
        message:
          'Você já denunciou este perfil e a denúncia ainda aguarda decisão. Não é preciso enviar de novo.',
      };
    }

    return { ok: true, reportId: outcome.reportId };
  } catch (error) {
    console.error(`[perfil] falha ao registrar denúncia: ${errorMessage(error)}`);
    return {
      ok: false,
      code: 'INTERNAL',
      message: 'Não foi possível registrar a denúncia agora. Tente novamente.',
    };
  }
}

export interface OwnFiledReport {
  reportId: string;
  reportedUserId: string;
  category: ProfileReportCategory;
  status: ProfileReportStatus;
  createdAt: Date;
}

/**
 * As denúncias desta pessoa NESTA instituição.
 *
 * Serve para a página pública não oferecer o mesmo botão de novo a quem já
 * denunciou (a recusa de verdade continua no serviço). NUNCA lança: a lista é
 * conveniência de tela, e uma falha dela não pode derrubar a página de um perfil —
 * no pior caso a pessoa vê o formulário e a action responde "já denunciou".
 */
export async function listOwnFiledReports(input: {
  tenantId: string;
  reporterUserId: string;
  limit?: number;
}): Promise<OwnFiledReport[]> {
  try {
    const rows = await withTenant(input.tenantId, (tx) =>
      tx.profileReport.findMany({
        where: { tenantId: input.tenantId, reporterUserId: input.reporterUserId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(1, input.limit ?? 50), 200),
        select: {
          id: true,
          reportedUserId: true,
          category: true,
          status: true,
          createdAt: true,
        },
      }),
    );

    return rows.map((row) => ({
      reportId: row.id,
      reportedUserId: row.reportedUserId,
      category: row.category as ProfileReportCategory,
      status: row.status as ProfileReportStatus,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error(`[perfil] falha ao listar as denúncias feitas: ${errorMessage(error)}`);
    return [];
  }
}
