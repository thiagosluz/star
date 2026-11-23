import Link from 'next/link';
import { AlertCircle, LogIn, Users } from 'lucide-react';

import { RegistrationForm } from '@/components/events/registration-form';
import { publicRegistrationNotice, restrictedEventNotice } from '@/domain/events/public-registration-rules';
import { tenantPath } from '@/domain/tenancy/resolution';

/** Painel lateral de inscrição na página pública da atividade (estados aberto/fechado/bloqueado/espera). */
export function ActivityRegistrationSidebar({
  tenantSlug,
  tenantName,
  eventSlug,
  activitySlug,
  requiresRegistration,
  remainingSeats,
  waitlistEnabled,
  activityStatus,
  activityClosed,
  windowOpen,
  windowMessage,
  isFull,
  isAuthenticated,
  membershipStatus,
  requiresMembership,
  canRegister,
  alreadyRegistered,
  myRegistrationId,
  loginHref,
}: {
  tenantSlug: string;
  tenantName: string;
  eventSlug: string;
  activitySlug: string;
  requiresRegistration: boolean;
  remainingSeats: number | null;
  waitlistEnabled: boolean;
  activityStatus: string;
  activityClosed: boolean;
  windowOpen: boolean;
  windowMessage: string | null;
  isFull: boolean;
  isAuthenticated: boolean;
  membershipStatus: string | null;
  requiresMembership: boolean;
  canRegister: boolean;
  alreadyRegistered: 'PENDING' | 'CONFIRMED' | 'WAITLISTED' | null;
  myRegistrationId: string | null;
  loginHref: string;
}) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
      {!requiresRegistration && !activityClosed ? (
        <div className="ef-card space-y-3 p-5" data-testid="activity-open-notice">
          <p className="flex items-center gap-2 font-medium">
            <Users className="size-4" aria-hidden />
            Aberta a todos os inscritos no evento
          </p>
          <p className="text-sm opacity-70">
            Esta atividade não tem inscrição individual: quem se inscreveu no evento participa dela automaticamente.
            {remainingSeats !== null ? ' O número de vagas é informativo.' : ''}
          </p>
          <Link
            href={tenantPath(tenantSlug, `/eventos/${eventSlug}/inscricao`)}
            className="ef-button w-full"
            data-testid="activity-event-registration-link"
          >
            Inscrever-se no evento
          </Link>
        </div>
      ) : activityClosed ? (
        <div className="ef-card space-y-2 p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            {activityStatus === 'CANCELED' ? 'Atividade cancelada' : 'Inscrições encerradas'}
          </p>
          <p className="text-sm opacity-70">
            {activityStatus === 'CANCELED'
              ? 'Esta atividade foi cancelada pela organização.'
              : 'Esta atividade já começou ou foi concluída.'}
          </p>
        </div>
      ) : !windowOpen && !alreadyRegistered ? (
        <div className="ef-card space-y-2 p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            Inscrições indisponíveis
          </p>
          <p className="text-sm opacity-70">{windowMessage}</p>
        </div>
      ) : !isAuthenticated ? (
        <div className="ef-card space-y-3 p-5">
          <p className="font-medium">Entre para se inscrever</p>
          <p className="text-sm opacity-70">
            Você precisa de uma conta na plataforma para reservar sua vaga. É rápido e vale para todas as
            instituições.
          </p>
          <Link href={loginHref} className="ef-button w-full">
            <LogIn className="size-4" aria-hidden />
            Entrar e continuar
          </Link>
          <Link
            href={`/signup?redirectTo=${encodeURIComponent(
              tenantPath(tenantSlug, `/eventos/${eventSlug}/atividades/${activitySlug}`),
            )}`}
            className="ef-button-outline w-full"
          >
            Criar conta
          </Link>
        </div>
      ) : membershipStatus === 'SUSPENDED' || membershipStatus === 'REMOVED' ? (
        <div className="ef-card space-y-2 p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            Acesso bloqueado
          </p>
          <p className="text-sm opacity-70">
            Seu acesso a {tenantName} está bloqueado. Fale com a organização do evento.
          </p>
        </div>
      ) : requiresMembership && membershipStatus !== 'ACTIVE' ? (
        <div className="ef-card space-y-2 p-5" data-testid="activity-restricted">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            Restrito à comunidade
          </p>
          <p className="text-sm opacity-70">{restrictedEventNotice(tenantName)}</p>
        </div>
      ) : !canRegister ? (
        <div className="ef-card space-y-2 p-5">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            Inscrição não permitida
          </p>
          <p className="text-sm opacity-70">
            Seu perfil não tem permissão para se inscrever em atividades nesta instituição.
          </p>
        </div>
      ) : isFull && !waitlistEnabled && !alreadyRegistered ? (
        <div className="ef-card space-y-2 p-5" data-testid="activity-full">
          <p className="flex items-center gap-2 font-medium">
            <AlertCircle className="size-4" aria-hidden />
            Atividade lotada
          </p>
          <p className="text-sm opacity-70">
            Todas as vagas foram preenchidas e esta atividade não possui lista de espera. Entre em contato com
            a organização para verificar a possibilidade de abrir novas vagas.
          </p>
        </div>
      ) : (
        <>
          {membershipStatus !== 'ACTIVE' ? (
            <div className="ef-card space-y-1 p-4 text-xs opacity-80" data-testid="public-registration-notice">
              <p>{publicRegistrationNotice(tenantName)}</p>
            </div>
          ) : null}

          <RegistrationForm
            tenantSlug={tenantSlug}
            eventSlug={eventSlug}
            activitySlug={activitySlug}
            isWaitlist={isFull && waitlistEnabled}
            alreadyRegistered={alreadyRegistered}
          />
        </>
      )}

      {myRegistrationId && alreadyRegistered ? (
        <p className="ef-muted text-center text-xs">
          Inscrição #{myRegistrationId.slice(0, 8)} · pode ser cancelada em “Minhas inscrições”.
        </p>
      ) : null}
    </aside>
  );
}
