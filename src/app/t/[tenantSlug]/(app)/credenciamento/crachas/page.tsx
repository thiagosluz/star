import Link from 'next/link';
import { ArrowLeft, IdCard, Search } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { listCredentialRoster } from '@/lib/events/credential-service';
import { BadgeRoster, type RosterEntry } from '@/components/credentials/badge-roster';
import { issueCredentialsAction, revokeCredentialAction } from '@/app/actions/credential-actions';

export const metadata = { title: 'Crachás' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ÁREA DE CRACHÁS (FASE 31)
 *  `/t/<slug>/credenciamento/crachas?evento=<eventId>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ELA É SEPARADA DO CREDENCIAMENTO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  São dois momentos e duas pessoas. O monitor, na porta, só lê crachá — a tela dele
 *  tem de ser uma coisa só, grande e à prova de toque errado. A EMISSÃO e a IMPRESSÃO
 *  acontecem antes do evento, na secretaria, com calma e com a lista inteira na tela.
 *  Juntar as duas coisas faria o monitor navegar por uma lista de 300 pessoas entre
 *  duas leituras.
 *
 *  A tela mostra TODOS os participantes do evento — quem tem inscrição no evento, quem
 *  tem inscrição em atividade e quem recebeu crachá à mão (equipe, palestrante,
 *  imprensa) — com a situação de credenciamento de cada um.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function BadgesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ evento?: string; q?: string; faltando?: string }>;
}) {
  const { tenantSlug } = await params;
  const { evento, q, faltando } = await searchParams;

  const { tenantId, tenantName } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.ATTENDANCE_MANAGE,
    allowedScopes: ['TENANT', 'EVENT'],
    fallbackPath: '/credenciamento',
  });

  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: { tenantId, deletedAt: null, status: { not: 'DRAFT' } },
      orderBy: { startsAt: 'desc' },
      take: 30,
      select: { id: true, title: true, startsAt: true },
    }),
  );

  const selectedEventId = evento && events.some((event) => event.id === evento) ? evento : events[0]?.id ?? null;

  const roster = selectedEventId
    ? await listCredentialRoster({
        tenantId,
        eventId: selectedEventId,
        query: q ?? null,
        onlyMissing: faltando === '1',
      })
    : null;

  const entries: RosterEntry[] =
    roster?.ok === true
      ? roster.entries.map((entry) => ({
          userId: entry.userId,
          name: entry.name,
          email: entry.email,
          credentialId: entry.credential?.id ?? null,
          code: entry.credential?.code ?? null,
          state: entry.credential?.state ?? null,
          legacy: entry.credential?.legacy ?? false,
          printed: entry.credential?.printedAt !== null && entry.credential?.printedAt !== undefined,
          arrivedLabel: entry.arrivedAt
            ? entry.arrivedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : null,
          activities: entry.registrations
            .filter((row) => row.activityId !== null)
            .map((row) => row.activityTitle ?? 'Atividade'),
          registrationStatus: entry.registrations.find((row) => row.activityId === null)?.status ?? null,
          attendedActivities: entry.attendedActivities,
          minutesAttended: entry.minutesAttended,
        }))
      : [];

  const missingCount = roster?.ok === true ? roster.withoutCredential : 0;

  return (
    <main className="max-w-5xl space-y-6">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/credenciamento')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Credenciamento
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IdCard className="size-6 text-primary" aria-hidden />
          Crachás
        </h1>
        <p className="text-sm text-muted-foreground">
          Um crachá por pessoa no evento, com o código que o balcão lê. O QR Code carrega só o código —
          nome, e-mail e identificador de pessoa <strong>não</strong> vão na etiqueta.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3" data-testid="badge-filters">
        <label className="space-y-1 text-xs font-medium">
          Evento
          <select
            name="evento"
            defaultValue={selectedEventId ?? ''}
            aria-label="Evento"
            data-testid="badge-event"
            className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title} · {event.startsAt.toLocaleDateString('pt-BR')}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs font-medium">
          Buscar
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="nome, e-mail, crachá ou atividade"
            aria-label="Buscar participante"
            data-testid="badge-search"
            className="block min-w-56 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>

        <label className="flex items-center gap-2 pb-2 text-xs">
          <input
            type="checkbox"
            name="faltando"
            value="1"
            defaultChecked={faltando === '1'}
            data-testid="badge-only-missing"
            className="size-3.5"
          />
          Só quem ainda não tem crachá
        </label>

        <button
          type="submit"
          data-testid="badge-filter-apply"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
        >
          <Search className="size-3.5" aria-hidden />
          Filtrar
        </button>
      </form>

      {roster && !roster.ok ? (
        <p className="rounded-lg border border-destructive/40 bg-card p-4 text-sm text-destructive">
          {roster.message}
        </p>
      ) : null}

      {roster?.ok === true ? (
        <p className="text-xs text-muted-foreground" data-testid="badge-summary">
          {roster.total} participante(s) · {roster.withCredential} com crachá · {roster.withoutCredential} sem
          crachá · {roster.arrived} já credenciado(s)
        </p>
      ) : null}

      {selectedEventId && roster?.ok === true ? (
        <BadgeRoster
          entries={entries}
          tenantSlug={tenantSlug}
          eventId={selectedEventId}
          missingCount={missingCount}
          emitAction={issueCredentialsAction}
          revokeAction={revokeCredentialAction}
          pdfPath={`/api/t/${tenantSlug}/credenciamento/crachas/folha`}
        />
      ) : (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Nenhum evento publicado nesta instituição.
        </p>
      )}
    </main>
  );
}
