import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CalendarDays, Ticket } from 'lucide-react';

import { getRequestContext } from '@/lib/auth/session';
import { listMyRegistrations } from '@/lib/events/registration-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { CancelRegistrationButton } from '@/components/events/cancel-registration-button';

export const metadata = { title: 'Minhas inscrições' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  CONFIRMED: 'Confirmada',
  WAITLISTED: 'Lista de espera',
  ATTENDED: 'Presença registrada',
  NO_SHOW: 'Não compareceu',
  PENDING: 'Pendente',
};

/** Inscrições do usuário na instituição ativa. */
export default async function MyRegistrationsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const context = await getRequestContext();
  if (!context) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(
        tenantPath(tenantSlug, '/minhas-inscricoes'),
      )}`,
    );
  }

  if (!context.activeTenant || context.activeTenant.tenantSlug !== tenantSlug) {
    redirect('/selecionar-instituicao');
  }

  const registrations = await listMyRegistrations(
    context.activeTenant.tenantId,
    context.user.id,
  );

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Minhas inscrições</h1>
        <p className="text-sm text-muted-foreground">
          Atividades em que você se inscreveu em {context.activeTenant.tenantName}.
        </p>
      </header>

      {registrations.length === 0 ? (
        <div className="space-y-4 rounded-lg border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Ticket className="size-4" aria-hidden />
            Você ainda não se inscreveu em nenhuma atividade.
          </p>
          <Link
            href={tenantPath(tenantSlug, '/eventos')}
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Ver eventos disponíveis
          </Link>
        </div>
      ) : (
        <ul className="space-y-3" data-testid="my-registrations">
          {registrations.map((registration) => (
            <li
              key={registration.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border bg-card p-4"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    data-testid="registration-status"
                  >
                    {STATUS_LABEL[registration.status] ?? registration.status}
                    {registration.status === 'WAITLISTED' &&
                    registration.waitlistPosition
                      ? ` · ${registration.waitlistPosition}º`
                      : ''}
                  </span>
                </div>

                <h2 className="font-medium">{registration.activityTitle}</h2>

                <p className="text-xs text-muted-foreground">
                  {registration.eventTitle}
                </p>

                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarDays className="size-3.5" aria-hidden />
                  {new Intl.DateTimeFormat('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(registration.activityStartsAt)}
                  <span className="ml-2 opacity-70">
                    · inscrito em{' '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                    }).format(registration.createdAt)}
                  </span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={tenantPath(
                    tenantSlug,
                    `/eventos/${registration.eventSlug}/atividades/${registration.activitySlug}`,
                  )}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                >
                  Ver atividade
                </Link>

                {(registration.status === 'CONFIRMED' ||
                  registration.status === 'WAITLISTED') && (
                  <CancelRegistrationButton
                    tenantSlug={tenantSlug}
                    eventSlug={registration.eventSlug}
                    registrationId={registration.id}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
