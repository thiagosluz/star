import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  CalendarDays,
  Clock,
  MapPin,
  Mic,
  Users,
  AlertCircle,
  LogIn,
} from 'lucide-react';

/**
 * Import por ALIAS, não relativo.
 *
 * O caminho relativo aqui é `../../../..` e fica frágil: mover a rota um nível
 * quebra o build silenciosamente (o erro só aparece no `next build`). O alias
 * `@/` é independente da profundidade da rota.
 */
import '@/app/t/[tenantSlug]/(public)/eventos/event-theme.css';

import { getPublicActivity, getTenantContext } from '@/lib/events/event-repository';
import {
  evaluateRegistrationWindow,
  formatDuration,
} from '@/domain/events/event-rules';
import {
  publicRegistrationNotice,
  restrictedEventNotice,
} from '@/domain/events/public-registration-rules';
import { getAuthenticatedUser, loadPrincipal } from '@/lib/auth/session';
import { adminPrisma } from '@/lib/db/admin-client';
import { findMyRegistrationFor } from '@/lib/events/registration-service';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RegistrationForm } from '@/components/events/registration-form';
import { Section, ThemeScope } from '@/components/events/theme-scope';

export const dynamic = 'force-dynamic';

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  LECTURE: 'Palestra',
  MINI_COURSE: 'Minicurso',
  WORKSHOP: 'Workshop',
  ROUND_TABLE: 'Mesa-redonda',
  HACKATHON: 'Hackathon',
  POSTER_SESSION: 'Sessão de pôsteres',
  ORAL_PRESENTATION: 'Apresentação oral',
  CULTURAL: 'Atividade cultural',
  OTHER: 'Atividade',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; activitySlug: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, activitySlug } = await params;
  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Atividade não encontrada' };

  const result = await getPublicActivity(tenant.tenantId, eventSlug, activitySlug);
  if (!result) return { title: 'Atividade não encontrada' };

  return {
    title: `${result.activity.title} · ${result.event.title}`,
    description: result.activity.description?.slice(0, 200) ?? undefined,
  };
}

/**
 * Página de uma atividade, com o formulário de inscrição.
 *
 * Três estados possíveis para o visitante:
 *   1. anônimo          -> convite para entrar, preservando o destino
 *   2. autenticado s/ inscrição -> formulário (ou aviso de janela fechada/lotada)
 *   3. autenticado c/ inscrição -> confirmação do status
 *
 * A checagem de permissão aqui é de UX; a autorização real está na Server Action.
 */
export default async function ActivityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; activitySlug: string }>;
}) {
  const { tenantSlug, eventSlug, activitySlug } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const result = await getPublicActivity(tenant.tenantId, eventSlug, activitySlug);
  if (!result) notFound();

  const { event, activity } = result;

  const window = evaluateRegistrationWindow({
    now: new Date(),
    eventStartsAt: event.startsAt,
    eventEndsAt: event.endsAt,
    eventStatus: event.status,
    registrationOpensAt: event.registrationOpensAt,
    registrationClosesAt: event.registrationClosesAt,
    activity: {
      startsAt: activity.startsAt,
      endsAt: activity.endsAt,
      status: activity.status,
    },
  });

  // ── Contexto do visitante ──────────────────────────────────────────────────
  const user = await getAuthenticatedUser();

  let membershipStatus: string | null = null;
  let alreadyRegistered: 'CONFIRMED' | 'WAITLISTED' | null = null;
  let myRegistrationId: string | null = null;
  let canRegister = false;

  if (user) {
    const membership = await adminPrisma.userTenantProfile.findFirst({
      where: { tenantId: tenant.tenantId, userId: user.id },
      select: { status: true, deletedAt: true },
    });
    membershipStatus = membership?.deletedAt ? 'REMOVED' : (membership?.status ?? null);

    if (membershipStatus === 'ACTIVE') {
      const principal = await loadPrincipal(user.id, tenant.tenantId, 'ACTIVE');
      canRegister = can(principal, PERMISSIONS.REGISTRATION_CREATE, {
        scope: 'TENANT',
      });
    } else {
      /**
       * INSCRIÇÃO PÚBLICA (FASE 10).
       *
       * Quem não é membro entra pela porta pública — a decisão definitiva é do
       * servidor (`decideParticipantLink`, sob RLS); aqui só espelhamos o resultado
       * para a tela não oferecer o que o servidor vai recusar. Vínculo suspenso ou
       * removido é BLOQUEIO da instituição, e a tela diz isso em vez de oferecer o
       * formulário.
       */
      canRegister = membershipStatus !== 'SUSPENDED' && membershipStatus !== 'REMOVED';
    }

    if (membershipStatus === 'ACTIVE') {
      const mine = await findMyRegistrationFor(
        tenant.tenantId,
        user.id,
        activity.id,
      );
      myRegistrationId = mine?.id ?? null;

      if (mine && (mine.status === 'CONFIRMED' || mine.status === 'WAITLISTED')) {
        alreadyRegistered = mine.status;
      }
    }
  }

  const isFull = activity.remainingSeats === 0;
  const activityClosed =
    activity.status === 'CANCELED' ||
    activity.status === 'COMPLETED' ||
    activity.status === 'IN_PROGRESS';

  const loginHref = `/login?redirectTo=${encodeURIComponent(
    tenantPath(tenantSlug, `/eventos/${eventSlug}/atividades/${activitySlug}`),
  )}`;

  return (
    <ThemeScope theme={event.theme}>
      <Section>
        <nav className="mb-6">
          <Link
            href={tenantPath(tenantSlug, `/eventos/${eventSlug}`)}
            className="text-xs opacity-60 underline underline-offset-4"
          >
            ← {event.title}
          </Link>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          {/* ── Detalhes ─────────────────────────────────────────────────── */}
          <article className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="ef-badge">
                {ACTIVITY_TYPE_LABEL[activity.type] ?? 'Atividade'}
              </span>
              {activity.status === 'CANCELED' ? (
                <span className="ef-badge text-destructive">Cancelada</span>
              ) : null}
              {isFull && activity.waitlistEnabled ? (
                <span className="ef-badge">Lista de espera disponível</span>
              ) : null}
            </div>

            <h1 className="text-balance text-3xl font-semibold tracking-tight">
              {activity.title}
            </h1>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 shrink-0 opacity-60" aria-hidden />
                <div>
                  <dt className="text-xs opacity-60">Data e horário</dt>
                  <dd data-testid="activity-schedule">
                    {new Intl.DateTimeFormat('pt-BR', {
                      weekday: 'long',
                      day: '2-digit',
                      month: 'long',
                      timeZone: event.timezone,
                    }).format(activity.startsAt)}
                    {', '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: event.timezone,
                    }).format(activity.startsAt)}{' '}
                    –{' '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: event.timezone,
                    }).format(activity.endsAt)}
                  </dd>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Clock className="size-4 shrink-0 opacity-60" aria-hidden />
                <div>
                  <dt className="text-xs opacity-60">Carga horária</dt>
                  <dd>{formatDuration(activity.workloadMinutes)}</dd>
                </div>
              </div>

              {activity.roomName ? (
                <div className="flex items-center gap-2">
                  <MapPin className="size-4 shrink-0 opacity-60" aria-hidden />
                  <div>
                    <dt className="text-xs opacity-60">Local</dt>
                    <dd>{activity.roomName}</dd>
                  </div>
                </div>
              ) : null}

              {activity.speakerNames.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Mic className="size-4 shrink-0 opacity-60" aria-hidden />
                  <div>
                    <dt className="text-xs opacity-60">
                      {activity.speakerNames.length === 1
                        ? 'Palestrante'
                        : 'Palestrantes'}
                    </dt>
                    <dd>{activity.speakerNames.join(', ')}</dd>
                  </div>
                </div>
              ) : null}

              <div className="flex items-center gap-2">
                <Users className="size-4 shrink-0 opacity-60" aria-hidden />
                <div>
                  <dt className="text-xs opacity-60">Vagas</dt>
                  <dd data-testid="activity-seats">
                    {activity.capacity === null
                      ? 'Ilimitadas'
                      : `${activity.confirmedCount} de ${activity.capacity} preenchidas`}
                    {activity.remainingSeats !== null && activity.remainingSeats > 0
                      ? ` · ${activity.remainingSeats} restantes`
                      : ''}
                  </dd>
                  {/**
                   * DIAGNÓSTICO PARA OS TESTES, EM ATRIBUTOS — nunca em texto.
                   *
                   * Aqui existia uma linha visível (`cap=150 conf=0 rem=150 mem=null
                   * can=false`), deixada durante a depuração da FASE 3 e esquecida: ela
                   * aparecia para QUALQUER visitante, expondo estado interno da inscrição
                   * (lotação, janela, vínculo, permissão) em página pública.
                   *
                   * O que os testes E2E precisam é do estado no momento da falha — e isso
                   * se entrega em atributos, que não renderizam nada. A tela não é lugar
                   * de diagnóstico.
                   */}
                  <dd
                    data-testid="activity-flags"
                    hidden
                    data-capacity={String(activity.capacity)}
                    data-confirmed={String(activity.confirmedCount)}
                    data-remaining={String(activity.remainingSeats)}
                    data-full={String(isFull)}
                    data-waitlist={String(activity.waitlistEnabled)}
                    data-status={activity.status}
                    data-window-open={String(window.open)}
                    data-registered={String(alreadyRegistered)}
                    data-membership={membershipStatus ?? 'null'}
                    data-can-register={String(canRegister)}
                    data-authenticated={user ? 'sim' : 'nao'}
                  />
                </div>
              </div>
            </dl>

            {activity.description ? (
              <div className="whitespace-pre-line text-pretty leading-relaxed opacity-80">
                {activity.description}
              </div>
            ) : null}

            {activity.tags.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {activity.tags.map((tag) => (
                  <li key={tag} className="ef-badge">
                    {tag}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>

          {/* ── Painel de inscrição ──────────────────────────────────────── */}
          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            {activityClosed ? (
              <div className="ef-card space-y-2 p-5">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  {activity.status === 'CANCELED'
                    ? 'Atividade cancelada'
                    : 'Inscrições encerradas'}
                </p>
                <p className="text-sm opacity-70">
                  {activity.status === 'CANCELED'
                    ? 'Esta atividade foi cancelada pela organização.'
                    : 'Esta atividade já começou ou foi concluída.'}
                </p>
              </div>
            ) : !window.open && !alreadyRegistered ? (
              <div className="ef-card space-y-2 p-5">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  Inscrições indisponíveis
                </p>
                <p className="text-sm opacity-70">{window.message}</p>
              </div>
            ) : !user ? (
              <div className="ef-card space-y-3 p-5">
                <p className="font-medium">Entre para se inscrever</p>
                <p className="text-sm opacity-70">
                  Você precisa de uma conta na plataforma para reservar sua vaga.
                  É rápido e vale para todas as instituições.
                </p>
                <Link href={loginHref} className="ef-button w-full">
                  <LogIn className="size-4" aria-hidden />
                  Entrar e continuar
                </Link>
                <Link
                  href={`/signup?redirectTo=${encodeURIComponent(
                    tenantPath(
                      tenantSlug,
                      `/eventos/${eventSlug}/atividades/${activitySlug}`,
                    ),
                  )}`}
                  className="ef-button-outline w-full"
                >
                  Criar conta
                </Link>
              </div>
            ) : membershipStatus === 'SUSPENDED' || membershipStatus === 'REMOVED' ? (
              /**
               * BLOQUEIO DA INSTITUIÇÃO (FASE 10).
               *
               * Antes esta tela dizia "peça um convite" para QUALQUER pessoa sem
               * vínculo — inclusive para quem a instituição havia removido. Eram
               * duas mensagens diferentes espremidas em uma: quem nunca teve
               * relação com a instituição (que agora se inscreve sozinho) e quem foi
               * bloqueado (que não deve se inscrever). Separar as duas é o que
               * permite a inscrição pública sem abrir a porta para quem foi barrado.
               */
              <div className="ef-card space-y-2 p-5">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  Acesso bloqueado
                </p>
                <p className="text-sm opacity-70">
                  Seu acesso a {tenant.name} está bloqueado. Fale com a organização do
                  evento.
                </p>
              </div>
            ) : event.registrationRequiresMembership && membershipStatus !== 'ACTIVE' ? (
              /**
               * EVENTO RESTRITO À COMUNIDADE (FASE 12, item I3).
               *
               * A instituição escolheu não abrir este evento — assembleia, turma
               * interna, reunião de conselho. É a situação que a FASE 10 passou a
               * tratar como "inscreva-se" em TODOS os eventos; aqui ela volta a ter
               * tratamento próprio, com `data-testid` porque o texto genérico de
               * antes ("peça um convite") não distinguia restrição de bloqueio.
               */
              <div className="ef-card space-y-2 p-5" data-testid="activity-restricted">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  Restrito à comunidade
                </p>
                <p className="text-sm opacity-70">{restrictedEventNotice(tenant.name)}</p>
              </div>
            ) : !canRegister ? (
              <div className="ef-card space-y-2 p-5">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  Inscrição não permitida
                </p>
                <p className="text-sm opacity-70">
                  Seu perfil não tem permissão para se inscrever em atividades
                  nesta instituição.
                </p>
              </div>
            ) : isFull && !activity.waitlistEnabled && !alreadyRegistered ? (
              /**
               * ─── ATIVIDADE LOTADA, SEM LISTA DE ESPERA ────────────────────
               *
               * Este ramo faltava, e a consequência era um bug de UX: com
               * `remainingSeats === 0` e `waitlistEnabled === false`, a página
               * exibia "1 de 1 preenchidas" e AINDA oferecia o botão de
               * inscrição. Quem clicasse recebia um erro do servidor — o
               * controle de lotação está correto, mas a interface prometia algo
               * que não existia.
               *
               * A condição inclui `!waitlistEnabled`: com lista de espera
               * habilitada, o caminho correto é o formulário com o rótulo
               * "Entrar na lista de espera", não este aviso.
               *
               * Descoberto pelo teste E2E "o último lugar fecha a atividade".
               */
              <div className="ef-card space-y-2 p-5" data-testid="activity-full">
                <p className="flex items-center gap-2 font-medium">
                  <AlertCircle className="size-4" aria-hidden />
                  Atividade lotada
                </p>
                <p className="text-sm opacity-70">
                  Todas as vagas foram preenchidas e esta atividade não possui
                  lista de espera. Entre em contato com a organização para
                  verificar a possibilidade de abrir novas vagas.
                </p>
              </div>
            ) : (
              <>
                {/**
                 * Aviso de vínculo (FASE 10): quem não é membro precisa saber que a
                 * inscrição cria o vínculo de participante. Fazer isso sem avisar
                 * seria inscrever a pessoa em algo que ela não pediu.
                 */}
                {membershipStatus !== 'ACTIVE' ? (
                  <div
                    className="ef-card space-y-1 p-4 text-xs opacity-80"
                    data-testid="public-registration-notice"
                  >
                    <p>{publicRegistrationNotice(tenant.name)}</p>
                  </div>
                ) : null}

                <RegistrationForm
                  tenantSlug={tenantSlug}
                  eventSlug={eventSlug}
                  activitySlug={activitySlug}
                  isWaitlist={isFull && activity.waitlistEnabled}
                  alreadyRegistered={alreadyRegistered}
                />
              </>
            )}

            {myRegistrationId && alreadyRegistered ? (
              <p className="text-center text-xs opacity-60">
                Inscrição #{myRegistrationId.slice(0, 8)} · pode ser cancelada em
                “Minhas inscrições”.
              </p>
            ) : null}
          </aside>
        </div>
      </Section>
    </ThemeScope>
  );
}
