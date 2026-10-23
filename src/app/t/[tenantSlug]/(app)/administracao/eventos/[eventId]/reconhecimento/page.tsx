import { GraduationCap } from 'lucide-react';

import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { getRequestContext } from '@/lib/auth/session';
import { getReviewerRanking } from '@/lib/gamification/achievement-service';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { ReviewerAwardPanel } from '@/components/reviews/reviewer-award';

export const metadata = { title: 'Reconhecimento do comitê científico' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RECONHECIMENTO DO COMITÊ CIENTÍFICO (FASE 16, item F1 · página na FASE 55)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Esta seção morava na tela do evento, dentro de um `<details>` no meio de outras
 *  quatro — e destoava: as demais áreas já eram CARTÕES que levam a uma tela, com
 *  ícone, uma linha de propósito e o selo do que há lá dentro. Aqui não: o
 *  organizador precisava abrir um bloco sanfona no fim da página para descobrir o
 *  que havia nele.
 *
 *  O conteúdo não mudou — o ranking de quem mais revisou e a concessão da carta —,
 *  e o `data-testid` da seção também não (`reviewer-award-section`), porque os specs
 *  da F16/F22 navegam por ele: mudar de endereço não é motivo para quebrar contrato.
 *
 *  Ela pertence ao grupo RESULTADO, e não a Configurar: não configura nada — premia.
 *  É o que fica depois do trabalho do comitê, junto dos certificados.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ReviewerRecognitionPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_GRANT,
  });

  const context = await getRequestContext();
  const canAward = can(context?.principal ?? null, PERMISSIONS.CARD_GRANT, { scope: 'TENANT' });

  const reviewerRanking = await getReviewerRanking({ tenantId, eventId });

  return (
    <main className="max-w-5xl space-y-8" data-testid="reviewer-recognition-page">
      <PageHeader
        title="Reconhecimento do comitê científico"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="Quem mais revisou neste evento — e a carta que a organização concede a essas pessoas."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: 'Evento', href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Reconhecimento do comitê científico' },
        ]}
      />

      <section data-testid="reviewer-award-section">
        {reviewerRanking.ok ? (
          <ReviewerAwardPanel
            tenantSlug={tenantSlug}
            eventId={eventId}
            ranking={reviewerRanking.ranked}
            minReviews={reviewerRanking.minReviews}
            cardNames={reviewerRanking.cardNames}
            reason={reviewerRanking.reason}
            canAward={canAward}
          />
        ) : (
          /**
           * Sem ranking a tela não fica vazia: diz o que fazer para o quadro existir.
           * Um "erro" aqui quase sempre significa "ainda não há parecer neste evento".
           */
          <p className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            <GraduationCap className="size-4 shrink-0" aria-hidden />
            {reviewerRanking.message}
          </p>
        )}
      </section>
    </main>
  );
}
