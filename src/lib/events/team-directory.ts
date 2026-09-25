/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — Equipes do evento para o editor da página (FASE 45)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA LEITURA NÃO MORA NO SERVIÇO DE DEMANDAS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `demand-service` monta o quadro de trabalho da equipe (colunas, cartões, prazos).
 *  Aqui a pergunta é outra — "quais equipes eu posso escolher no bloco de equipe?" —
 *  e a resposta é curta de propósito: id, nome e quantas pessoas. Reusar o quadro
 *  inteiro para preencher um `<select>` traria demandas e contadores que a tela não
 *  usa, e amarraria o editor a um serviço que muda por motivos de operação.
 *
 *  Conta apenas equipe ATIVA: equipe desativada não entra na vitrine, então oferecê-la
 *  no seletor seria oferecer um filtro que não mostra nada.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';

export interface EventTeamOption {
  id: string;
  name: string;
  memberCount: number;
}

/** As equipes ativas do evento, para o seletor do bloco de equipe. */
export async function listEventTeamOptions(
  tenantId: string,
  eventId: string,
): Promise<EventTeamOption[]> {
  const teams = await withTenant(tenantId, (tx) =>
    tx.eventTeam.findMany({
      where: { tenantId, eventId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, _count: { select: { members: true } } },
    }),
  );

  return teams.map((team) => ({
    id: team.id,
    name: team.name,
    memberCount: team._count.members,
  }));
}
