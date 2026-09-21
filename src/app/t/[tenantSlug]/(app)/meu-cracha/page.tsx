import Link from 'next/link';
import QRCode from 'qrcode';
import { ArrowLeft, IdCard, QrCode } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { getOwnCredential } from '@/lib/events/credential-service';
import { OwnBadge } from '@/components/credentials/own-badge';
import { generateOwnCredentialAction } from '@/app/actions/credential-actions';

export const metadata = { title: 'Meu crachá' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  MEU CRACHÁ (FASE 31)
 *  `/t/<slug>/meu-cracha?evento=<eventId>`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O PARTICIPANTE TEM ESTA TELA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O crachá de papel resolve quem chegou cedo e passou pela secretaria. Quem se
 *  inscreveu na véspera, ou perdeu a etiqueta, ou entrou por outra porta, não tem
 *  crachá nenhum — e é justamente quem trava a fila do balcão.
 *
 *  Aqui a própria pessoa abre o PRÓPRIO crachá e mostra o QR na tela do celular. Três
 *  decisões sustentam isso:
 *
 *    1. o código nasce na primeira ABERTURA (idempotente: um por pessoa por evento),
 *       então a organização não precisa emitir antes para a pessoa ter o dela;
 *    2. a autorização é a POSSE: só a pessoa vê o próprio crachá, e o serviço confere
 *       que ela tem inscrição no evento — não é uma tela de balcão;
 *    3. o código aparece por EXTENSO embaixo do QR: leitor que não enxerga tela (ou
 *       câmera embaçada) ainda consegue digitar.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function OwnBadgePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ evento?: string }>;
}) {
  const { tenantSlug } = await params;
  const { evento } = await searchParams;

  const { tenantId, tenantName, userId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_READ_OWN,
  });

  const context = await getRequestContext();
  const personId = context?.user?.id ?? userId;

  /**
   * Os eventos que a PESSOA tem: onde ela se inscreveu (evento ou atividade) ou onde
   * já existe crachá. É a lista da própria participação, e não o catálogo da
   * instituição — ninguém abre "meu crachá" de um evento em que não está.
   */
  const events = await withTenant(tenantId, (tx) =>
    tx.event.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [
          { registrations: { some: { userId: personId, deletedAt: null, status: { not: 'CANCELED' } } } },
          { eventCredentials: { some: { userId: personId } } },
        ],
      },
      orderBy: { startsAt: 'desc' },
      take: 30,
      select: { id: true, title: true, slug: true, startsAt: true },
    }),
  );

  const selectedEventId = evento && events.some((event) => event.id === evento) ? evento : events[0]?.id ?? null;

  const badge = selectedEventId
    ? await getOwnCredential({ tenantId, userId: personId, eventId: selectedEventId })
    : null;

  return (
    <main className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/minhas-inscricoes')}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Minhas inscrições
          </Link>
        </nav>

        <p className="text-xs uppercase tracking-wide text-muted-foreground">{tenantName}</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <IdCard className="size-6 text-primary" aria-hidden />
          Meu crachá
        </h1>
        <p className="text-sm text-muted-foreground">
          Mostre este QR Code no balcão para registrar a sua presença. Ele é o mesmo crachá em todas as
          atividades do evento — quem escolhe a atividade é o monitor, na leitura.
        </p>
      </header>

      {events.length === 0 ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Você não tem inscrição em nenhum evento desta instituição. Inscreva-se no evento ou em uma
          atividade para receber o seu crachá.
        </p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs font-medium">
              Evento
              <select
                name="evento"
                defaultValue={selectedEventId ?? ''}
                aria-label="Evento"
                data-testid="own-badge-event"
                className="block min-w-64 rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
              >
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.title} · {event.startsAt.toLocaleDateString('pt-BR')}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted"
            >
              Ver
            </button>
          </form>

          {badge && !badge.ok ? (
            <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning-strong">
              <QrCode className="mt-0.5 size-4 shrink-0" aria-hidden />
              {badge.message}
            </p>
          ) : null}

          {badge?.ok === true ? (
            <OwnBadge
              tenantSlug={tenantSlug}
              eventId={badge.eventId}
              eventTitle={badge.eventTitle}
              eventSlug={badge.eventSlug}
              startsAtLabel={badge.startsAt.toLocaleString('pt-BR', {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
              code={badge.code}
              qrSvg={await QRCode.toString(badge.qrPayload, {
                type: 'svg',
                margin: 1,
                width: 220,
              })}
              state={badge.state}
              registered={badge.registrations.length > 0}
              activities={badge.registrations.map((row) => row.activityTitle ?? 'Inscrição no evento')}
              attendedActivities={badge.attendedActivities}
              minutesAttended={badge.minutesAttended}
              generateAction={generateOwnCredentialAction}
            />
          ) : null}
        </>
      )}
    </main>
  );
}
