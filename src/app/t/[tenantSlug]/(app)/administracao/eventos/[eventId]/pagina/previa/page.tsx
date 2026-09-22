import { notFound } from 'next/navigation';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { PUBLICATION_STATE_LABELS } from '@/domain/events/landing-page';
import { getEventForPreview } from '@/lib/events/event-repository';
import { getLandingForEdit } from '@/lib/admin/landing-service';
import { listPublicRaffleResults } from '@/lib/raffles/raffle-service';
import { listPublicCalls } from '@/lib/proposals/call-service';
import { EventLanding } from '@/components/events/event-landing';

export const metadata = { title: 'Pré-visualização da página' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PRÉ-VISUALIZAÇÃO DO RASCUNHO (FASE 23, item E9)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O PROBLEMA QUE ISTO RESOLVE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Publicar era a única forma de ver a página montada. O organizador publicava para
 *  conferir e despublicava depois — e nesse intervalo a página incompleta ficava no
 *  ar, com o link já circulando entre os inscritos. A prévia elimina o intervalo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A ROTA É AUTENTICADA, E O SELO É EXPLÍCITO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Ela vive sob `administracao` e exige `page:manage`: nenhum caminho público leva a
 *  material não publicado. E o aviso no topo diz o estado real da página — sem ele,
 *  duas abas abertas (prévia e site) seriam indistinguíveis.
 *
 *  O QUE A PRÉVIA NÃO MOSTRA: contadores de vaga em tempo real não têm diferença aqui
 *  (a leitura é a mesma); e os RESULTADOS DE SORTEIO publicados aparecem, porque a
 *  seção é parte da página que o visitante vê.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventLandingPreviewPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PAGE_MANAGE,
  });

  const [event, landing] = await Promise.all([
    getEventForPreview(tenantId, eventId),
    getLandingForEdit(tenantId, eventId),
  ]);

  if (!event) notFound();

  const publicRaffles = await listPublicRaffleResults(tenantId, event.id);
  const now = new Date();

  /**
   * A prévia mostra as chamadas PUBLICADAS — as mesmas que o visitante verá. Aqui não
   * há versão "de rascunho" do bloco: publicar a chamada é o ato que a torna visível, e
   * antecipá-la na prévia faria o organizador aprovar uma página que não existe.
   */
  const calls = await listPublicCalls({ tenantId, eventId: event.id, now });

  const state = landing?.page?.publicationState ?? 'DRAFT';
  const scheduledFor = landing?.page?.publishAt ?? null;

  const publicationLabel = scheduledFor
    ? `${PUBLICATION_STATE_LABELS[state].toLowerCase()} (${new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(scheduledFor)})`
    : PUBLICATION_STATE_LABELS[state].toLowerCase();

  return (
    <EventLanding
      event={event}
      tenantSlug={tenantSlug}
      tenantName={tenantName}
      now={now}
      publicRaffles={publicRaffles}
      publicCalls={calls.ok ? calls.calls : []}
      preview={{
        publicationLabel,
        editorHref: tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`),
      }}
    />
  );
}
