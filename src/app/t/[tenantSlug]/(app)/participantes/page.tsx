import { Suspense } from 'react';
import { Contact } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { resolveEventQuerySelection } from '@/domain/validation/query-filter-rules';
import { Alert, PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { ParticipantFilterBar } from '@/components/participants/participant-filter-bar';
import { ParticipantSkeleton } from '@/components/participants/participant-skeleton';
import { ParticipantResults } from '@/components/participants/participant-results';

export const metadata = { title: 'Participantes' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DIRETÓRIO DE PARTICIPANTES DA INSTITUIÇÃO (FASE 32 / FASE 103 · ADR-430)
 *  `/t/<slug>/participantes?busca=&evento=&certificado=1&presente=1&pagina=2`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA EXISTE (E O QUE ELA NÃO É)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui a instituição só conseguia ver pessoas por EVENTO (a lista de crachás, a
 *  lista de inscritos) — nunca a PESSOA. Quem participou de quatro eventos ao longo
 *  de dois anos não tinha um lugar onde aparecesse inteiro.
 *
 *  Ela NÃO é a tela de equipe (`/administracao/equipe`, que é sobre vínculo e papel)
 *  nem o credenciamento (que é sobre o dia do evento). É o cadastro vivo do público:
 *  quem é, o que viveu aqui e o que já recebemos de nós.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STREAMING E SUSPENSE CIRÚRGICO (FASE 103 · ADR-430)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O cabeçalho e a barra de filtros são entregues imediatamente ao cliente,
 *  enquanto o carregamento pesado de participantes com histórico consolidado
 *  roda em streaming via `<Suspense fallback={<ParticipantSkeleton />}>`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function ParticipantsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{
    busca?: string;
    evento?: string;
    certificado?: string;
    presente?: string;
    pagina?: string;
    /** Exportação recém-criada: a tela volta com o identificador do pedido (FASE 49). */
    exportacao?: string;
    /** Motivo da recusa, quando o pedido de exportação não deu certo. */
    erro?: string;
  }>;
}) {
  const { tenantSlug } = await params;
  const { busca, evento, certificado, presente, pagina, exportacao, erro } = await searchParams;

  /**
   * O principal vem da GUARDA (FASE 75 · fatia 4): ela já o resolveu para decidir
   * `participant:read`. Chamar `getRequestContext()` outra vez aqui repetia a
   * leitura de vínculos e a transação do principal no mesmo render.
   */
  const { tenantId, principal } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.PARTICIPANT_READ,
  });

  /** A permissão de LER não implica a de FALAR: quem não pode enviar não vê o painel. */
  const canMessage = can(principal, PERMISSIONS.PARTICIPANT_MESSAGE, { scope: 'TENANT' }) === true;

  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'desc' },
      take: 50,
      select: { id: true, title: true, startsAt: true },
    }),
  );

  const eventSelection = resolveEventQuerySelection({
    value: evento,
    events,
    fallback: 'all',
  });
  const { selectedEventId } = eventSelection;

  const filterKey = `${busca ?? ''}-${selectedEventId ?? ''}-${certificado ?? ''}-${presente ?? ''}-${pagina ?? ''}-${exportacao ?? ''}-${erro ?? ''}`;

  return (
    <main className="max-w-6xl space-y-6">
      <PageHeader
        title="Participantes"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Contact className="size-6 text-primary" aria-hidden />}
        description="Todas as pessoas que já participaram de algum evento desta instituição — com presença, certificados, cartas e XP somados. O e-mail aparece mascarado; a ficha mostra o endereço completo e registra quem abriu."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Participantes' },
        ]}
      />

      {eventSelection.discardedNotice ? (
        <Alert tone="warning" data-testid="participant-event-notice">
          {eventSelection.discardedNotice}
        </Alert>
      ) : null}

      <ParticipantFilterBar
        tenantSlug={tenantSlug}
        events={events}
        initialBusca={busca ?? ''}
        initialEvento={selectedEventId ?? ''}
        initialCertificado={certificado === '1'}
        initialPresente={presente === '1'}
      />

      <Suspense fallback={<ParticipantSkeleton />}>
        <ParticipantResults
          key={filterKey}
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          canMessage={canMessage}
          busca={busca}
          selectedEventId={selectedEventId ?? undefined}
          certificado={certificado}
          presente={presente}
          pagina={pagina}
          exportacao={exportacao}
          erro={erro}
        />
      </Suspense>

      <p className="text-xs text-muted-foreground">
        A abertura da ficha de uma pessoa e toda exportação ficam registradas na trilha de auditoria,
        com autor e instante.
      </p>
    </main>
  );
}
