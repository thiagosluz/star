import { tenantPath } from '@/domain/tenancy/resolution';
import { listParticipants } from '@/lib/participants/participant-service';
import { getDataExport, listRecentDataExports } from '@/lib/exports/export-service';
import { ExportPanel } from '@/components/exports/export-panel';
import { ENGAGEMENT_LABELS, PARTICIPANT_ORIGIN_LABELS } from '@/domain/participants/participant-rules';
import { ParticipantDirectory, type DirectoryEntry } from '@/components/participants/participant-directory';
import { sendParticipantMessageAction } from '@/app/actions/participant-actions';
import { AppLink } from '@/components/ui/app-link';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RESULTADOS DO DIRETÓRIO DE PARTICIPANTES (FASE 103 · ADR-430)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  STREAMING E SUSPENSE CIRÚRGICO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  As agregações pesadas de participantes (visitas, minutos, certificados, cartas
 *  e XP) são isoladas neste Server Component assíncrono.
 *  Enquanto ele processa a query e as métricas agregadas, a casca da página
 *  (`PageHeader` e `ParticipantFilterBar`) é entregue imediatamente pelo Next.js 16.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function ParticipantResults({
  tenantId,
  tenantSlug,
  canMessage,
  busca,
  selectedEventId,
  certificado,
  presente,
  pagina,
  exportacao,
  erro,
}: {
  tenantId: string;
  tenantSlug: string;
  canMessage: boolean;
  busca?: string;
  selectedEventId?: string;
  certificado?: string;
  presente?: string;
  pagina?: string;
  exportacao?: string;
  erro?: string;
}) {
  const listing = await listParticipants({
    tenantId,
    query: busca?.trim() || undefined,
    eventId: selectedEventId ?? undefined,
    onlyWithCertificate: certificado === '1',
    onlyAttended: presente === '1',
    page: Number.parseInt(pagina ?? '1', 10) || 1,
  });

  const entries: DirectoryEntry[] =
    listing.ok === true
      ? listing.entries.map((entry) => ({
          userId: entry.userId,
          name: entry.name,
          emailMasked: entry.emailMasked,
          originLabel: PARTICIPANT_ORIGIN_LABELS[entry.origin],
          events: entry.events,
          confirmed: entry.confirmed,
          attended: entry.attended,
          visits: entry.visits,
          minutes: entry.minutes,
          certificates: entry.certificates,
          cards: entry.cards,
          xp: entry.xp,
          rateLabel: entry.rate.hasData ? `${entry.rate.percent}%` : '—',
          ratePercent: entry.rate.percent,
          engagement: entry.engagement.map((tag) => ENGAGEMENT_LABELS[tag]),
          lastActivityLabel: entry.lastActivityAt
            ? entry.lastActivityAt.toLocaleDateString('pt-BR')
            : null,
        }))
      : [];

  const query = new URLSearchParams();
  if (busca) query.set('busca', busca);
  if (selectedEventId) query.set('evento', selectedEventId);
  if (certificado === '1') query.set('certificado', '1');
  if (presente === '1') query.set('presente', '1');

  const recentExports = await listRecentDataExports({ tenantId, kind: 'PARTICIPANTS_CSV' });
  const createdExport = exportacao ? await getDataExport({ tenantId, exportId: exportacao }) : null;

  const pageHref = (target: number): string => {
    const next = new URLSearchParams(query);
    next.set('pagina', String(target));

    return `${tenantPath(tenantSlug, '/participantes')}?${next}`;
  };

  if (!listing.ok) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
        {listing.message}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground" data-testid="participant-summary">
          {listing.page.total} pessoa(s) na instituição · página {listing.page.page} de{' '}
          {listing.page.totalPages}
        </p>

        {selectedEventId ? (
          <p className="text-xs text-muted-foreground" data-testid="participant-event-scope">
            Inscrições, presenças, visitas, minutos, comparecimento, certificados, cartas e XP
            são deste evento. O total de eventos e os rótulos continuam sendo da pessoa na
            instituição.
          </p>
        ) : null}

        {listing.truncated ? (
          <p className="text-xs text-warning-strong" data-testid="participant-truncated">
            A lista mostra as primeiras pessoas do filtro — refine a busca ou exporte o CSV para o
            conjunto completo.
          </p>
        ) : null}
      </div>

      <ExportPanel
        tenantSlug={tenantSlug}
        kinds={['PARTICIPANTS_CSV']}
        returnTo={tenantPath(tenantSlug, '/participantes') + (query.size > 0 ? `?${query}` : '')}
        filters={{
          busca: busca ?? undefined,
          evento: selectedEventId ?? undefined,
          certificado: certificado === '1',
          presente: presente === '1',
        }}
        error={erro ?? null}
        created={createdExport?.kind === 'PARTICIPANTS_CSV' ? createdExport : null}
        recent={recentExports}
        testId="export-participants"
      />

      <ParticipantDirectory
        entries={entries}
        tenantSlug={tenantSlug}
        action={sendParticipantMessageAction}
        canMessage={canMessage}
        selectedEventId={selectedEventId ?? null}
      />

      {listing.page.totalPages > 1 ? (
        <nav className="flex items-center gap-3 text-sm" data-testid="participant-pagination">
          {listing.page.page > 1 ? (
            <AppLink href={pageHref(listing.page.page - 1)} className="underline underline-offset-4">
              Anterior
            </AppLink>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {listing.page.page} / {listing.page.totalPages}
          </span>
          {listing.page.page < listing.page.totalPages ? (
            <AppLink href={pageHref(listing.page.page + 1)} className="underline underline-offset-4">
              Próxima
            </AppLink>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
