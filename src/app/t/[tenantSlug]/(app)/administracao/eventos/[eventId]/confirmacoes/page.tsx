import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, BadgeCheck, Clock, Search, Users } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listConfirmationQueue } from '@/lib/events/confirmation-service';
import { confirmRegistrationAction } from '@/app/actions/admin-actions';
import { InlineActionForm } from '@/components/admin/inline-action-form';

export const metadata = { title: 'Confirmações de vaga' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FILA DE CONFIRMAÇÕES DE VAGA (FASE 34)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA TELA EXISTE — E POR QUE É A PRIMEIRA LISTA DE INSCRITOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até aqui o painel mostrava CONTAGENS por atividade ("12 inscritos") e nenhuma
 *  lista de quem são. A confirmação de vaga tornou a lista inevitável: a equipe
 *  precisa encontrar a pessoa que está no balcão, ver o que ela trouxe, e registrar a
 *  confirmação — e precisa encontrar QUEM ESTÁ PARA PERDER A VAGA antes do prazo
 *  vencer, que é o único momento em que ainda dá para fazer alguma coisa.
 *
 *  A ordem da lista é o PRAZO, não o nome: a fila é uma fila de tempo.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUEM CONFIRMA É A EQUIPE (decisão do humano nesta fase)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Não há caminho de autosserviço: a confirmação registra que a instituição recebeu o
 *  pagamento, a doação ou o item, e o que a pessoa assinaria sozinha não é prova para
 *  quem cobra. O e-mail e o aviso na plataforma dizem O QUE levar e ONDE ir; a
 *  confirmação acontece aqui.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventConfirmationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{ atividade?: string; busca?: string }>;
}) {
  const { tenantSlug, eventId } = await params;
  const { atividade, busca } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.REGISTRATION_UPDATE_ANY,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const result = await listConfirmationQueue({
    tenantId,
    eventId,
    activityId: atividade ?? null,
    search: busca ?? null,
  });

  if (!result.ok) notFound();

  const { queue } = result;
  const basePath = `/administracao/eventos/${eventId}/confirmacoes`;

  const deadlineTone = (state: string): string =>
    state === 'EXPIRED' ? 'text-destructive' : 'text-secondary-strong';

  return (
    <main className="space-y-8">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Confirmações de vaga</h1>
        <p className="text-sm text-muted-foreground">
          {event.title} · quem confirma é a equipe, no local combinado com o participante.
        </p>
      </header>

      {queue.activities.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-border bg-card p-6">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <BadgeCheck className="size-4" aria-hidden />
            Nenhuma atividade deste evento exige confirmação de vaga.
          </p>
          <p className="text-xs text-muted-foreground">
            A confirmação é escolhida no cadastro da atividade, em{' '}
            <Link
              href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
              className="underline"
            >
              Programação
            </Link>
            . Sem ela, a vaga é confirmada no ato da inscrição.
          </p>
        </div>
      ) : (
        <>
          {/* ── As atividades confirmáveis, com o que espera em cada uma ─────── */}
          <section className="space-y-3">
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Atividades com confirmação
            </h2>

            <ul className="grid gap-2 sm:grid-cols-2" data-testid="confirmation-activities">
              {queue.activities.map((activity) => {
                const selected = queue.selected?.activityId === activity.id;

                return (
                  <li key={activity.id}>
                    <Link
                      href={tenantPath(tenantSlug, `${basePath}?atividade=${activity.id}`)}
                      className={`block rounded-lg border p-3 text-sm transition hover:bg-accent ${
                        selected ? 'border-primary bg-accent' : 'border-border'
                      }`}
                      data-testid={`confirmation-activity-${activity.id}`}
                      aria-current={selected ? 'true' : undefined}
                    >
                      <p className="font-medium">{activity.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat('pt-BR', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                          timeZone: queue.eventTimeZone,
                        }).format(activity.startsAt)}
                        {activity.windowDays ? ` · prazo de ${activity.windowDays} dia(s)` : ''}
                      </p>
                      <p className="mt-1 flex items-center gap-3 text-xs">
                        <span
                          className={`flex items-center gap-1 ${
                            activity.pending > 0 ? 'text-secondary-strong' : 'text-muted-foreground'
                          }`}
                        >
                          <Clock className="size-3" aria-hidden />
                          {activity.pending} aguardando
                        </span>
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <BadgeCheck className="size-3" aria-hidden />
                          {activity.confirmed} confirmada(s)
                        </span>
                      </p>
                      {/**
                        * O PRÓXIMO VENCIMENTO no cartão da atividade: é o número que
                        * decide a ordem da fila, e sem ele o organizador teria de abrir
                        * cada atividade para saber qual corre mais.
                        */}
                      {activity.earliestDueAt ? (
                        <p className="mt-0.5 text-xs text-secondary-strong">
                          próximo vencimento em{' '}
                          {new Intl.DateTimeFormat('pt-BR', {
                            dateStyle: 'short',
                            timeStyle: 'short',
                            timeZone: queue.eventTimeZone,
                          }).format(activity.earliestDueAt)}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          {queue.selected ? (
            <>
              {/* ── O combinado da atividade: é o que o balcão confere ──────── */}
              <section className="rounded-lg border border-border bg-card p-4 text-sm">
                <h2 className="font-medium">{queue.selected.title}</h2>

                {queue.selected.requirements.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">
                      O que a pessoa precisa apresentar
                    </p>
                    <ul className="ml-4 list-disc text-muted-foreground" data-testid="confirmation-requirements">
                      {queue.selected.requirements.map((requirement) => (
                        <li key={requirement}>{requirement}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {queue.selected.place ? (
                  <p className="mt-2 text-muted-foreground">
                    Onde confirmar: <strong>{queue.selected.place}</strong>
                  </p>
                ) : null}

                {queue.selected.instructions ? (
                  <p className="mt-1 text-muted-foreground">{queue.selected.instructions}</p>
                ) : null}

                {/* ── Busca: nome ou e-mail, resolvida no banco ─────────────── */}
                <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="atividade" value={queue.selected.activityId} />
                  <label className="space-y-1 text-xs">
                    <span className="block text-muted-foreground">
                      Buscar por nome ou e-mail
                    </span>
                    <span className="flex items-center gap-2 rounded-md border border-border px-2">
                      <Search className="size-3.5 text-muted-foreground" aria-hidden />
                      <input
                        type="search"
                        name="busca"
                        defaultValue={busca ?? ''}
                        placeholder="Maria ou maria@exemplo.br"
                        className="w-56 bg-transparent py-1.5 text-sm outline-none"
                        data-testid="confirmation-search"
                      />
                    </span>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-accent"
                  >
                    Buscar
                  </button>
                  {busca ? (
                    <Link
                      href={tenantPath(tenantSlug, `${basePath}?atividade=${queue.selected.activityId}`)}
                      className="px-2 py-1.5 text-xs text-muted-foreground underline"
                    >
                      limpar
                    </Link>
                  ) : null}
                </form>
              </section>

              {/* ── Quem aguarda confirmação ─────────────────────────────────── */}
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  <Clock className="size-4" aria-hidden />
                  Aguardando confirmação ({queue.pending.length})
                </h2>

                {queue.pending.length === 0 ? (
                  <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                    {busca
                      ? 'Ninguém aguardando confirmação com essa busca.'
                      : 'Ninguém aguardando confirmação nesta atividade.'}
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border" data-testid="confirmation-pending">
                    {queue.pending.map((row) => (
                      <li
                        key={row.registrationId}
                        className="flex flex-wrap items-start justify-between gap-3 p-3"
                        data-testid={`confirmation-row-${row.registrationId}`}
                      >
                        <div className="min-w-0 space-y-0.5 text-sm">
                          <p className="font-medium">{row.personName}</p>
                          <p className="text-xs text-muted-foreground">{row.emailMasked}</p>
                          <p className={`flex items-center gap-1.5 text-xs ${deadlineTone(row.state)}`}>
                            {row.state === 'EXPIRED' ? (
                              <AlertTriangle className="size-3.5" aria-hidden />
                            ) : (
                              <Clock className="size-3.5" aria-hidden />
                            )}
                            {row.state === 'EXPIRED'
                              ? `prazo vencido em ${row.deadlineLabel} — a vaga está para ser liberada`
                              : `confirma até ${row.deadlineLabel} (${row.countdown})`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Inscrito em{' '}
                            {new Intl.DateTimeFormat('pt-BR', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                              timeZone: queue.eventTimeZone,
                            }).format(row.registeredAt)}
                          </p>
                        </div>

                        {/**
                          * A confirmação pede CONFIRMAÇÃO na tela quando o prazo já
                          * venceu: ali a vaga pode ser liberada pela varredura a
                          * qualquer momento, e registrar a confirmação é uma corrida
                          * com o relógio — melhor avisar do que recusar em silêncio.
                          */}
                        <InlineActionForm
                          action={confirmRegistrationAction}
                          submitLabel="Confirmar vaga"
                          variant="primary"
                          testId={`confirm-registration-${row.registrationId}`}
                          confirm={
                            row.state === 'EXPIRED'
                              ? {
                                  title: `Confirmar a vaga de ${row.personName} com o prazo vencido?`,
                                  description:
                                    'O prazo já passou e a vaga pode ser liberada automaticamente a qualquer momento. Confirmar registra o recebimento agora — se a liberação automática já tiver acontecido, o sistema recusa.',
                                  confirmLabel: 'Confirmar mesmo assim',
                                }
                              : undefined
                          }
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="eventId" value={eventId} />
                          <input type="hidden" name="registrationId" value={row.registrationId} />
                        </InlineActionForm>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ── Quem já foi confirmado: é o comprovante da equipe ────────── */}
              <section className="space-y-3">
                <h2 className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  <Users className="size-4" aria-hidden />
                  Já confirmadas ({queue.confirmed.length})
                </h2>

                {queue.confirmed.length === 0 ? (
                  <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                    Ninguém confirmado nesta atividade ainda.
                  </p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border" data-testid="confirmation-done">
                    {queue.confirmed.map((row) => (
                      <li key={row.registrationId} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
                        <div className="min-w-0 space-y-0.5">
                          <p className="font-medium">{row.personName}</p>
                          <p className="text-xs text-muted-foreground">{row.emailMasked}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {row.confirmedAt
                            ? `confirmada em ${new Intl.DateTimeFormat('pt-BR', {
                                dateStyle: 'short',
                                timeStyle: 'short',
                                timeZone: queue.eventTimeZone,
                              }).format(row.confirmedAt)}`
                            : 'confirmada'}
                          {row.confirmedByName ? ` · por ${row.confirmedByName}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : null}
        </>
      )}
    </main>
  );
}
