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
  /** `PENDING` = vaga RETIDA aguardando a confirmação da equipe (FASE 34). */
  PENDING: 'Vaga reservada — falta confirmar',
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

                  {/**
                    * A inscrição DO EVENTO é a que dá acesso à programação aberta —
                    * ela precisa se distinguir das demais na lista. E a linha criada
                    * automaticamente diz de onde veio: a pessoa não escolheu aquela
                    * atividade, ela veio junto com o evento.
                    */}
                  {registration.isEventRegistration ? (
                    <span
                      className="rounded border border-secondary/50 px-2 py-0.5 text-xs text-secondary-strong"
                      data-testid="registration-event-badge"
                    >
                      Inscrição no evento
                    </span>
                  ) : null}

                  {registration.isAutomatic ? (
                    <span
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      data-testid="registration-automatic-badge"
                    >
                      Incluída pela inscrição no evento
                    </span>
                  ) : null}
                </div>

                <h2 className="font-medium">{registration.activityTitle}</h2>

                <p className="text-xs text-muted-foreground">
                  {registration.eventTitle}
                </p>

                {registration.isEventRegistration ? (
                  <p className="text-xs text-muted-foreground">
                    Vale para todas as atividades abertas a participantes.
                  </p>
                ) : (
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
                )}

                {/**
                  * ── A VAGA ESTÁ RETIDA (FASE 34) ────────────────────────────────
                  *
                  *  Quem confirma é a EQUIPE, no local indicado — então aqui não há
                  *  botão: o que a pessoa precisa é do prazo, do checklist do que
                  *  levar e do lugar aonde ir. Um botão "confirmar" que a equipe
                  *  recusaria seria uma promessa falsa.
                  */}
                {registration.confirmation ? (
                  <div
                    className="mt-2 space-y-1 rounded-md border border-secondary/50 bg-secondary/5 p-3 text-xs"
                    data-testid="registration-confirmation"
                    data-confirmation-state={registration.confirmation.state}
                  >
                    {registration.confirmation.state === 'PENDING' ? (
                      <>
                        <p className="font-medium text-secondary-strong">
                          Falta confirmar sua vaga
                          {registration.confirmation.countdown
                            ? ` — ${registration.confirmation.countdown}`
                            : ''}
                        </p>
                        <p className="text-muted-foreground">
                          A confirmação é feita pela organização
                          {registration.confirmation.place
                            ? ` em ${registration.confirmation.place}`
                            : ''}
                          {registration.confirmation.deadlineLabel
                            ? `, até ${registration.confirmation.deadlineLabel}`
                            : ''}
                          . Sem ela, a vaga é liberada automaticamente.
                        </p>
                      </>
                    ) : null}

                    {registration.confirmation.state === 'EXPIRED' ? (
                      <>
                        <p className="font-medium text-secondary-strong">
                          Prazo de confirmação vencido
                        </p>
                        <p className="text-muted-foreground">
                          O prazo terminou
                          {registration.confirmation.deadlineLabel
                            ? ` em ${registration.confirmation.deadlineLabel}`
                            : ''}
                          . A vaga está sendo liberada — procure a organização se ainda houver tempo.
                        </p>
                      </>
                    ) : null}

                    {registration.confirmation.state === 'CONFIRMED' ? (
                      <p className="font-medium text-secondary-strong">
                        Vaga confirmada pela organização
                        {registration.confirmation.confirmedAt
                          ? ` em ${new Intl.DateTimeFormat('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            }).format(registration.confirmation.confirmedAt)}`
                          : ''}
                      </p>
                    ) : null}

                    {/**
                      * ── O CHECKLIST ITEM A ITEM (FASE 37) ─────────────────────────
                      *
                      *  Quando a inscrição tem itens, é ESTA a lista que vale: ela é o
                      *  snapshot do que foi cobrado desta pessoa, com o estado que a
                      *  equipe registrou no balcão. A lista de `requirements` (a
                      *  configuração ATUAL da atividade) só aparece quando não há itens
                      *  — inscrição anterior à FASE 37 ou atividade que ainda não teve
                      *  o checklist gerado. Mostrar as duas faria a tela dizer duas
                      *  coisas diferentes sobre a mesma vaga depois de uma edição.
                      */}
                    {registration.confirmation.items.length > 0 ? (
                      <div
                        className="space-y-0.5"
                        data-testid="registration-confirmation-items"
                        data-items-summary={registration.confirmation.itemsSummary}
                      >
                        <p className="text-muted-foreground">
                          O que a organização registrou ({registration.confirmation.itemsSummary}):
                        </p>
                        <ul className="space-y-0.5">
                          {registration.confirmation.items.map((item) => (
                            <li
                              key={item.id}
                              className="flex flex-wrap items-baseline gap-x-2"
                              data-testid={`registration-item-${item.id}`}
                              data-item-status={item.status}
                            >
                              <span aria-hidden>
                                {item.status === 'PENDING' ? '○' : '●'}
                              </span>
                              <span
                                className={
                                  item.status === 'PENDING' ? '' : 'text-muted-foreground line-through'
                                }
                              >
                                {item.label}
                                {item.required ? '' : ' (opcional)'}
                                {item.note ? ` — ${item.note}` : ''}
                              </span>
                              <span className="text-muted-foreground">
                                {item.statusLabel}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : registration.confirmation.requirements.length > 0 ? (
                      <div data-testid="registration-confirmation-requirements">
                        <p className="text-muted-foreground">O que é preciso levar/apresentar:</p>
                        <ul className="ml-4 list-disc text-muted-foreground">
                          {registration.confirmation.requirements.map((requirement) => (
                            <li key={requirement}>{requirement}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {registration.isEventRegistration ? (
                  <Link
                    href={tenantPath(tenantSlug, `/eventos/${registration.eventSlug}`)}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                  >
                    Ver evento
                  </Link>
                ) : (
                  <Link
                    href={tenantPath(
                      tenantSlug,
                      `/eventos/${registration.eventSlug}/atividades/${registration.activitySlug}`,
                    )}
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                  >
                    Ver atividade
                  </Link>
                )}

                {/**
                  * Desistir também vale para quem está com a vaga RETIDA: se a pessoa
                  * não vai confirmar, é melhor que a vaga volte para a fila agora do que
                  * no fim do prazo. O cancelamento é terminal e devolve a vaga.
                  */}
                {(registration.status === 'CONFIRMED' ||
                  registration.status === 'WAITLISTED' ||
                  registration.status === 'PENDING') && (
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
