import { notFound } from 'next/navigation';

import { getTenantContext, listPublicEvents } from '@/lib/events/event-repository';
import { isPubliclyVisible } from '@/domain/events/event-rules';
import { PublicEventList } from '@/components/tenancy/public-event-list';

export const dynamic = 'force-dynamic';

/**
 * Lista pública de eventos da instituição — `/t/<slug>/eventos`.
 *
 * A lista inteira vive em `PublicEventList` (FASE 64 · fatia 2): ela tem dois pontos
 * de montagem, porque a página personalizada da instituição cai nesta listagem
 * quando nunca foi publicada. O que fica aqui é só a leitura e o `<main>` — o
 * landmark é de cada TELA, e esta tela tem exatamente um.
 *
 * O TOPO também vem de lá (FASE 78 · fatia 4): o `PageHeader` ("Eventos" + a
 * contagem do serviço) mora no componente compartilhado, e não nesta página, para
 * que os dois pontos de montagem desenhem o MESMO cabeçalho. A catraca da F78
 * registra a delegação (`TOPO_COMPARTILHADO`) e confere que o componente usa o
 * topo único — esta página não escreve `<h1>` nem `<header>` nenhum.
 */
export default async function PublicEventsPage({
  searchParams,
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { tenantSlug } = await params;

  const { pagina } = await searchParams;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  /**
   * A página vem da URL e o banco devolve só a fatia dela (FASE 56 · dívida E2).
   * O filtro de visibilidade continua aqui como conferência — é o MESMO conjunto de
   * status que o repositório usa no `where`, então não esconde o que foi contado.
   */
  const page = await listPublicEvents(tenant.tenantId, { page: pagina });
  const events = page.events.filter((event) => isPubliclyVisible(event.status));

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <PublicEventList
        tenantSlug={tenantSlug}
        tenantName={tenant.name}
        page={page}
        events={events}
      />
    </main>
  );
}
