import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { buildEventMetadata } from '@/domain/events/landing-page';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listPublicRaffleResults } from '@/lib/raffles/raffle-service';
import { EventLanding } from '@/components/events/event-landing';

export const dynamic = 'force-dynamic';

/**
 * Metadados gerados a partir do evento.
 *
 * O organizador pode sobrescrever título e descrição pela página do evento
 * (`EventPage.metaTitle`/`metaDescription`); quando não o faz, montamos uma
 * descrição a partir de resumo, subtítulo, data e local — uma landing page sem
 * descrição perde muito em compartilhamento.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Evento não encontrado' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Evento não encontrado' };

  const meta = buildEventMetadata(event);
  const title = event.page?.metaTitle ?? meta.title;
  const description = event.page?.metaDescription ?? meta.description;

  return {
    title,
    description,
    openGraph: { ...meta.openGraph, title, description },
    alternates: { canonical: tenantPath(tenantSlug, `/eventos/${event.slug}`) },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Landing page pública do evento
 *
 *  Server Component: o HTML sai completo do servidor. Toda a composição vive em
 *  `EventLanding` (FASE 23), porque a PRÉ-VISUALIZAÇÃO do rascunho precisa renderizar
 *  exatamente o mesmo — e a página pública deixou de ser uma tela para ser um dos
 *  dois consumidores do componente.
 *
 *  Quem chega aqui vê a página PUBLICADA; quem está montando vê a mesma coisa em
 *  `/administracao/eventos/<id>/pagina/previa`, com a página atual (mesmo rascunho).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function PublicEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string }>;
}) {
  const { tenantSlug, eventSlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  /**
   * Instante da renderização, resolvido UMA vez e passado adiante.
   *
   * Derivar status, janela de inscrição e contagem regressiva do MESMO instante evita
   * inconsistência (ex.: o selo dizer "inscrições abertas" enquanto a janela já
   * fechou por milissegundos), e mantém os componentes de renderização puros.
   */
  const now = new Date();

  const publicRaffles = await listPublicRaffleResults(tenant.tenantId, event.id);

  return (
    <EventLanding
      event={event}
      tenantSlug={tenantSlug}
      tenantName={tenant.name}
      now={now}
      publicRaffles={publicRaffles}
    />
  );
}
