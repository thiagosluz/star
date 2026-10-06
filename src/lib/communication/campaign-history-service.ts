/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  APLICAÇÃO — O histórico das campanhas (FASE 67 · fatia 2)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA LEITURA NÃO USA `listCampaigns`
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A leitura da fatia 1 devolve o que o disparo precisa saber sobre si mesmo
 *  (contagens e estado). A TELA precisa de mais uma coisa — o AUTOR —, e a decisão
 *  de seis meses atrás se lê assim: quem mandou, com que texto, para quantos e por
 *  qual definição. Em vez de mudar o serviço da fatia 1 (que tem teste e é
 *  contrato), a tela ganha a própria leitura, com os MESMOS campos mais o nome de
 *  quem disparou.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O AUTOR SAI SEM MÁSCARA, E A DIFERENÇA É DE NATUREZA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A máscara da ocultação (F60/E79) protege a identidade do PARTICIPANTE nas
 *  superfícies internas. Quem aparece aqui é a EQUIPE que disparou a campanha —
 *  ato de administração, registrado para auditoria, como o autor de uma exclusão no
 *  acervo. Mascarar o operador tornaria a trilha inútil sem proteger ninguém.
 *
 *  `createdById` é nulo quando a conta foi excluída: o ATO sobrevive a quem o
 *  praticou, e a tela diz "conta removida" em vez de sumir com a linha.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
import { withTenant } from '@/lib/db/tenant-client';
import type { CampaignStatusValue } from '@/domain/communication/campaign-rules';

export interface CampaignHistoryRow {
  id: string;
  subject: string;
  status: CampaignStatusValue;
  eventId: string | null;
  eventTitle: string | null;
  /** Nome de quem disparou; `null` = a conta foi excluída. */
  authorName: string | null;
  /** As frases do segmento CONGELADAS no ato — o que a campanha selecionou. */
  explanation: readonly string[];
  recipientCount: number;
  reachedCount: number;
  failedCount: number;
  skippedCount: number;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

const DEFAULT_LIMIT = 20;

/**
 * As campanhas da instituição, da mais recente para a mais antiga.
 *
 * O filtro por evento é opcional de propósito: a tela de comunicação é da
 * INSTITUIÇÃO, e esconder as campanhas de outros eventos faria o organizador
 * concluir que elas sumiram.
 */
export async function listCampaignHistory(input: {
  tenantId: string;
  limit?: number;
}): Promise<readonly CampaignHistoryRow[]> {
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIMIT, 1), 100);

  const rows = await withTenant(input.tenantId, (tx) =>
    tx.communicationCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        subject: true,
        status: true,
        eventId: true,
        explanation: true,
        recipientCount: true,
        reachedCount: true,
        failedCount: true,
        skippedCount: true,
        error: true,
        createdAt: true,
        finishedAt: true,
        event: { select: { title: true } },
        createdBy: { select: { name: true } },
      },
    }),
  );

  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    status: row.status,
    eventId: row.eventId,
    eventTitle: row.event?.title ?? null,
    authorName: row.createdBy?.name ?? null,
    explanation: row.explanation,
    recipientCount: row.recipientCount,
    reachedCount: row.reachedCount,
    failedCount: row.failedCount,
    skippedCount: row.skippedCount,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  }));
}
