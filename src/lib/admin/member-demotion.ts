/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Rebaixar membro da equipe para PARTICIPANTE (FASE 50 · dívida C7)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ISTO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O vínculo com a instituição é UMA linha por (instituição, pessoa), e `kind` diz se
 *  ela é EQUIPE (`MEMBER`) ou PÚBLICO (`PARTICIPANT`). Remover alguém da equipe gravava
 *  `status = REMOVED` — e isso tirava os DOIS acessos de uma vez: a pessoa deixava de
 *  organizar (correto) e também perdia a área de participante, com as próprias
 *  inscrições, certificados e cartas (errado). As inscrições continuavam registradas; o
 *  acesso é que desaparecia.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE MUDA, E O QUE NÃO MUDA
 *  ─────────────────────────────────────────────────────────────────────────────
 *   • `kind` passa a `PARTICIPANT` — a pessoa deixa de consumir vaga no plano (a quota
 *     conta `MEMBER` ativo ou convidado) e some da tela de equipe;
 *   • TODAS as concessões são revogadas, em qualquer escopo (instituição, evento,
 *     atividade), porque quem saiu da equipe não continua credenciando um dia de evento;
 *   • o vínculo segue `ACTIVE`: a área de participante, as inscrições e os documentos
 *     continuam acessíveis — é esse o ponto da dívida;
 *   • a trilha guarda o fato com o nome de quem rebaixou, e a tela diz o que aconteceu.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS MESMAS TRAVAS DA REMOÇÃO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não rebaixar a si mesmo e não rebaixar o último proprietário: as duas respostas vêm
 *  do domínio (`evaluateMemberRemoval`), com a contagem de proprietários lida na MESMA
 *  transação. Trocar a trava aqui seria abrir a porta que a FASE 21 fechou — quem se
 *  rebaixa por último deixa a instituição sem dono.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { recordAudit } from '@/lib/admin/audit';
import { withTenant, type TxClient } from '@/lib/db/tenant-client';
import { evaluateMemberRemoval } from '@/domain/tenancy/membership-rules';

export type DemoteResult =
  | { ok: true; name: string; revokedRoles: readonly string[] }
  | { ok: false; code: string; message: string };

/**
 * Contexto do alvo — o mesmo que a remoção lê, para as travas valerem igual.
 *
 * A contagem de proprietários é GLOBAL do alvo (concessões `OWNER` de escopo da
 * instituição, vigentes): é ela que impede a instituição de ficar sem dono.
 */
async function loadTarget(tx: TxClient, tenantId: string, userId: string) {
  const profile = await tx.userTenantProfile.findFirst({
    where: { tenantId, userId, kind: 'MEMBER', deletedAt: null },
    select: { id: true, status: true, user: { select: { name: true } } },
  });

  if (!profile) return null;

  const [roles, ownerCount] = await Promise.all([
    tx.roleAssignment.findMany({
      where: { tenantId, userId, revokedAt: null },
      select: { id: true, role: true, scope: true },
    }),
    tx.roleAssignment.count({
      where: { tenantId, role: 'OWNER', scope: 'TENANT', revokedAt: null },
    }),
  ]);

  return {
    profileId: profile.id,
    name: profile.user.name,
    status: profile.status,
    roles,
    tenantRoles: roles.filter((role) => role.scope === 'TENANT').map((role) => role.role),
    activeOwnerCount: ownerCount,
  };
}

export async function demoteMemberToParticipant(input: {
  tenantId: string;
  actorId: string;
  userId: string;
}): Promise<DemoteResult> {
  try {
    const outcome = await withTenant(input.tenantId, async (tx) => {
      const target = await loadTarget(tx, input.tenantId, input.userId);

      if (!target) return { kind: 'NOT_FOUND' as const };

      const verdict = evaluateMemberRemoval({
        actorUserId: input.actorId,
        targetUserId: input.userId,
        targetStatus: target.status,
        targetRoles: target.tenantRoles,
        activeOwnerCount: target.activeOwnerCount,
      });

      if (!verdict.allowed) {
        return { kind: 'REFUSED' as const, code: verdict.code, message: verdict.message };
      }

      const now = new Date();

      if (target.roles.length > 0) {
        await tx.roleAssignment.updateMany({
          where: { tenantId: input.tenantId, userId: input.userId, revokedAt: null },
          data: {
            revokedAt: now,
            reason: `Acesso de equipe convertido em participante por ${input.actorId}`,
          },
        });
      }

      /**
       * O vínculo CONTINUA (status `ACTIVE`) e muda de NATUREZA. `deletedAt` fica nulo:
       * a área de participante existe justamente porque a linha existe.
       */
      await tx.userTenantProfile.update({
        where: { id: target.profileId },
        data: { kind: 'PARTICIPANT', updatedAt: now },
      });

      return { kind: 'OK' as const, target };
    });

    if (outcome.kind === 'NOT_FOUND') {
      return { ok: false, code: 'NOT_FOUND', message: 'Vínculo de equipe não encontrado.' };
    }

    if (outcome.kind === 'REFUSED') {
      return { ok: false, code: outcome.code, message: outcome.message };
    }

    const revokedRoles = outcome.target.roles.map((entry) =>
      entry.scope === 'TENANT' ? entry.role : `${entry.role} (${entry.scope})`,
    );

    await recordAudit({
      tenantId: input.tenantId,
      userId: input.actorId,
      action: 'UPDATE',
      entityType: 'UserTenantProfile',
      entityId: input.userId,
      changes: {
        kind: { from: 'MEMBER', to: 'PARTICIPANT' },
        roles: { from: outcome.target.tenantRoles.join(', ') || '—', to: '—' },
      },
    });

    return { ok: true, name: outcome.target.name, revokedRoles };
  } catch (error) {
    console.error(
      `[members] falha ao rebaixar membro: ${error instanceof Error ? error.message : String(error)}`,
    );

    return { ok: false, code: 'INTERNAL', message: 'Não foi possível converter o acesso.' };
  }
}
