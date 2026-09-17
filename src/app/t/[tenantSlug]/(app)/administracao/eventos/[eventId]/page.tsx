import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, CalendarRange, FileText, GraduationCap } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import {
  saveActivityAction,
  saveEventAction,
  saveRoomAction,
  saveTrackAction,
} from '@/app/actions/admin-actions';

export const metadata = { title: 'Gerenciar evento' };
export const dynamic = 'force-dynamic';

const ACTIVITY_TYPES = [
  { value: 'LECTURE', label: 'Palestra' },
  { value: 'MINI_COURSE', label: 'Minicurso' },
  { value: 'WORKSHOP', label: 'Oficina' },
  { value: 'ROUND_TABLE', label: 'Mesa-redonda' },
  { value: 'HACKATHON', label: 'Hackathon' },
  { value: 'POSTER_SESSION', label: 'Sessão de pôsteres' },
  { value: 'ORAL_PRESENTATION', label: 'Apresentação oral' },
  { value: 'CULTURAL', label: 'Atividade cultural' },
  { value: 'OTHER', label: 'Outra' },
];

const ACTIVITY_STATUS = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'SCHEDULED', label: 'Programada' },
  { value: 'FULL', label: 'Lotada' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'COMPLETED', label: 'Concluída' },
  { value: 'CANCELED', label: 'Cancelada' },
];

const MODALITY = [
  { value: 'IN_PERSON', label: 'Presencial' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'HYBRID', label: 'Híbrido' },
];

const EVENT_STATUS = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'REGISTRATION_OPEN', label: 'Inscrições abertas' },
  { value: 'REGISTRATION_CLOSED', label: 'Inscrições encerradas' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'FINISHED', label: 'Encerrado' },
  { value: 'CANCELED', label: 'Cancelado' },
  { value: 'ARCHIVED', label: 'Arquivado' },
];

function toLocalInput(date: Date | null): string {
  if (!date) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * Gestão de UM evento: dados, salas, programação e trilhas.
 *
 * Tudo em uma página porque as quatro coisas são decididas JUNTAS na prática:
 * mudar o horário do evento afeta a programação, e criar uma atividade exige saber
 * quais salas existem. Separar em quatro telas obrigaria a navegar para conferir o
 * que já foi configurado.
 */
export default async function AdminEventDetailPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const roomOptions = [
    { value: '', label: 'Sem sala definida' },
    ...event.rooms.map((room) => ({ value: room.id, label: `${room.name} (${room.capacity} lugares)` })),
  ];

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao/eventos')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Eventos
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1>
        <p className="text-xs text-muted-foreground">
          {event.startsAt.toLocaleDateString('pt-BR')} a {event.endsAt.toLocaleDateString('pt-BR')} ·{' '}
          {event.registrationCount} inscrição(ões) · {event.activityCount} atividade(s) ·{' '}
          {event.trackCount} trilha(s)
        </p>
        <p className="flex flex-wrap items-center gap-4 text-xs">
          <Link
            href={tenantPath(tenantSlug, `/eventos/${event.slug}`)}
            target="_blank"
            className="underline underline-offset-4"
          >
            Ver página pública →
          </Link>
          {/*
            O sorteio tem tela própria e fica a um clique do evento: é operação de
            palco, e quem organiza precisa achar rápido.
          */}
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/sorteios`)}
            className="font-medium underline underline-offset-4"
            data-testid="raffles-link"
          >
            Sorteios →
          </Link>
        </p>
      </header>

      {/* ── Dados do evento ──────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="event-details">
        <summary className="cursor-pointer text-base font-semibold">
          <CalendarRange className="mr-2 inline size-4" aria-hidden />
          Dados do evento
        </summary>

        <div className="pt-4">
          <AdminForm action={saveEventAction} submitLabel="Salvar evento" testId="edit-event">
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Identificador" name="slug" required defaultValue={event.slug} />
              <Field label="Título" name="title" required defaultValue={event.title} />
              <Field label="Resumo" name="summary" defaultValue={event.summary} />
              <Field label="Local" name="venueName" defaultValue={event.venueName} />
              <Field label="Cidade" name="city" defaultValue={event.city} />
              <Field label="UF" name="state" defaultValue={event.state} />
              <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(event.startsAt)} />
              <Field label="Término" name="endsAt" type="datetime-local" required defaultValue={toLocalInput(event.endsAt)} />
              <Field label="Fuso horário" name="timezone" required defaultValue={event.timezone} />
              <Field label="Vagas" name="capacity" type="number" min={0} defaultValue={event.capacity} />
              <Field label="Cor principal" name="primaryColor" defaultValue={event.primaryColor} />
              <Field label="Inscrições abrem em" name="registrationOpensAt" type="datetime-local" defaultValue={toLocalInput(event.registrationOpensAt)} />
              <Field label="Inscrições fecham em" name="registrationClosesAt" type="datetime-local" defaultValue={toLocalInput(event.registrationClosesAt)} />
              <Field label="Chamada abre" name="cfpOpensAt" type="datetime-local" defaultValue={toLocalInput(event.cfpOpensAt)} />
              <Field label="Chamada fecha" name="cfpClosesAt" type="datetime-local" defaultValue={toLocalInput(event.cfpClosesAt)} />
              <SelectField label="Situação" name="status" options={EVENT_STATUS} defaultValue={event.status} />
              <SelectField label="Modalidade" name="modality" options={MODALITY} defaultValue={event.modality} />
            </div>
          </AdminForm>
        </div>
      </details>

      {/* ── Salas ────────────────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="rooms-section">
        <summary className="cursor-pointer text-base font-semibold">
          <Building2 className="mr-2 inline size-4" aria-hidden />
          Salas ({event.rooms.length})
        </summary>

        <div className="space-y-4 pt-4">
          {event.rooms.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border" data-testid="room-list">
              {event.rooms.map((room) => (
                <li key={room.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span>{room.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{room.capacity} lugares</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma sala cadastrada.</p>
          )}

          <AdminForm action={saveRoomAction} submitLabel="Salvar sala" testId="create-room" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nome da sala" name="name" required placeholder="Auditório Principal" />
              <Field label="Capacidade" name="capacity" type="number" min={1} required defaultValue={50} />
            </div>
          </AdminForm>
        </div>
      </details>

      {/* ── Atividades ───────────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="activities-section">
        <summary className="cursor-pointer text-base font-semibold">
          <GraduationCap className="mr-2 inline size-4" aria-hidden />
          Programação ({event.activities.length})
        </summary>

        <div className="space-y-4 pt-4">
          {event.activities.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border" data-testid="activity-list">
              {event.activities.map((activity) => (
                <li key={activity.id} className="space-y-0.5 p-3 text-sm">
                  <p className="font-medium">{activity.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {activity.type} · {activity.startsAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                    {activity.workloadMinutes} min · {activity.roomName ?? 'sem sala'} ·{' '}
                    {activity.capacity ?? 'sem limite'} vaga(s)
                    {activity.waitlistEnabled ? ' · lista de espera' : ''}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma atividade programada.</p>
          )}

          <AdminForm action={saveActivityAction} submitLabel="Criar atividade" testId="create-activity" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Identificador" name="slug" required placeholder="minicurso-rust" />
              <Field label="Título" name="title" required placeholder="Minicurso: Rust para iniciantes" />
              <SelectField label="Tipo" name="type" options={ACTIVITY_TYPES} defaultValue="LECTURE" />
              <SelectField label="Situação" name="status" options={ACTIVITY_STATUS} defaultValue="SCHEDULED" />
              <SelectField label="Modalidade" name="modality" options={MODALITY} defaultValue="IN_PERSON" />
              <SelectField label="Sala" name="roomId" options={roomOptions} />
              <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(event.startsAt)} />
              <Field label="Término" name="endsAt" type="datetime-local" required defaultValue={toLocalInput(new Date(event.startsAt.getTime() + 3_600_000))} />
              <Field label="Carga horária (min)" name="workloadMinutes" type="number" min={1} required defaultValue={60} />
              <Field label="Vagas" name="capacity" type="number" min={0} />
            </div>

            <div className="flex flex-wrap gap-4">
              <CheckboxField label="Habilitar lista de espera" name="waitlistEnabled" />
              <CheckboxField label="Destacar na página" name="isFeatured" />
              <CheckboxField label="Habilitar credenciamento" name="checkInEnabled" defaultChecked />
            </div>
          </AdminForm>
        </div>
      </details>

      {/* ── Trilhas ──────────────────────────────────────────────────────── */}
      <details className="rounded-xl border border-border bg-card p-5" data-testid="tracks-section">
        <summary className="cursor-pointer text-base font-semibold">
          <FileText className="mr-2 inline size-4" aria-hidden />
          Chamada de trabalhos ({event.tracks.length})
        </summary>

        <div className="space-y-4 pt-4">
          {event.tracks.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border" data-testid="track-list">
              {event.tracks.map((track) => (
                <li key={track.id} className="space-y-0.5 p-3 text-sm">
                  <p className="font-medium">{track.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {track.requiredReviews} parecer(es) · aceite ≥ {track.acceptanceThreshold} · rejeição &lt;{' '}
                    {track.rejectThreshold} · {track.submissionCount} submissão(ões) ·{' '}
                    {track.isActive ? 'ativa' : 'inativa'}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhuma trilha criada.</p>
          )}

          <AdminForm action={saveTrackAction} submitLabel="Criar trilha" testId="create-track" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Identificador" name="slug" required placeholder="tecnologia-educacional" />
              <Field label="Nome" name="name" required placeholder="Trilha de Tecnologia Educacional" />
              <Field label="Cor" name="color" placeholder="#1d4ed8" hint="Hexadecimal ou oklch()" />
              <Field label="Limite por autor (0 = ilimitado)" name="maxSubmissionsPerAuthor" type="number" min={0} defaultValue={3} />
              <Field label="Pareceres exigidos" name="requiredReviews" type="number" min={1} defaultValue={2} />
              <Field label="Nota de aceite" name="acceptanceThreshold" type="number" min={0} max={100} defaultValue={70} />
              <Field label="Nota de rejeição" name="rejectThreshold" type="number" min={0} max={100} defaultValue={45} />
            </div>

            <div className="flex flex-wrap gap-4">
              <CheckboxField label="Exigir revisão cega" name="requiresBlindReview" defaultChecked />
              <CheckboxField label="Trilha ativa" name="isActive" defaultChecked />
            </div>

            <fieldset className="space-y-2 rounded-lg border border-border p-3">
              <legend className="px-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                Rubrica (opcional — vazio usa a rubrica padrão)
              </legend>

              {[0, 1, 2].map((index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-4">
                  <Field label={`Critério ${index + 1}`} name="rubricKey" placeholder="originality" />
                  <Field label="Rótulo" name="rubricLabel" placeholder="Originalidade" />
                  <Field label="Peso" name="rubricWeight" type="number" min={1} defaultValue={index === 0 ? 3 : 1} />
                  <Field label="Nota máxima" name="rubricMaxScore" type="number" min={1} defaultValue={10} />
                </div>
              ))}
            </fieldset>
          </AdminForm>
        </div>
      </details>
    </main>
  );
}
