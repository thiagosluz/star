import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Building2, CalendarRange, FileText, GraduationCap } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { getRequestContext } from '@/lib/auth/session';
import { can } from '@/domain/rbac/authorization';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { getReviewerRanking } from '@/lib/gamification/achievement-service';
import { activityStatusLabel, activityTypeLabel } from '@/domain/events/activity-rules';
import { effectiveActivityCapacity, roomCapacityLabel } from '@/domain/events/event-rules';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { ReviewerAwardPanel } from '@/components/reviews/reviewer-award';
import {
  deleteActivityAction,
  deleteRoomAction,
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
 * As vagas REAIS da atividade, com a sala no lugar de onde ela limita.
 *
 * O organizador digita "80 vagas" numa sala de 40, e a tela dizia 80 — um número que
 * o sistema nunca entregaria. A conta é a mesma do servidor
 * (`effectiveActivityCapacity`), e a frase explica de onde vem o número menor em vez
 * de simplesmente trocá-lo (revisão da FASE 3).
 */
function activitySeatsLabel(activity: { capacity: number | null; roomCapacity: number | null }): string {
  const effective = effectiveActivityCapacity(activity.capacity, activity.roomCapacity);

  const limitedByRoom =
    activity.roomCapacity !== null &&
    (activity.capacity === null || activity.capacity > activity.roomCapacity);

  const base = effective === null ? 'sem limite' : `${effective} vaga(s)`;

  return limitedByRoom ? `${base} — a sala comporta ${activity.roomCapacity}` : base;
}

/**
 * Atividade ABERTA numa sala pequena para o público do evento.
 *
 * Atividade aberta não tem fila nem recusa: quem se inscreve no evento entra nela
 * (decisão da revisão da FASE 3). O aviso existe porque a sala é física — se o evento
 * tem 300 inscritos e a sala comporta 40, o organizador precisa saber ANTES do dia,
 * e o sistema não pode resolver isso negando acesso em silêncio.
 */
function openActivityOverflowsRoom(activity: {
  requiresRegistration: boolean;
  roomCapacity: number | null;
}, eventRegistrationCount: number): boolean {
  return (
    !activity.requiresRegistration &&
    activity.roomCapacity !== null &&
    eventRegistrationCount > activity.roomCapacity
  );
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

  /**
   * Ranking de revisores + permissão de premiar (FASE 16, item F1).
   *
   * A leitura do ranking é do evento; a CONCESSÃO da carta exige `card:grant`. Quem
   * só administra o evento vê o ranking e entende por que o botão não está ali — em
   * vez de clicar e receber um erro.
   */
  const context = await getRequestContext();
  const principal = context?.principal ?? null;
  const canAward = can(principal, PERMISSIONS.CARD_GRANT, { scope: 'TENANT' });
  const reviewerRanking = await getReviewerRanking({ tenantId, eventId });

  const roomOptions = [
    { value: '', label: 'Sem sala definida' },
    ...event.rooms.map((room) => ({
      value: room.id,
      label: `${room.name} (${roomCapacityLabel(room.capacity)})`,
    })),
  ];

  return (
    <main className="max-w-5xl space-y-8">
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
          {/*
            Página pública e patrocínio (FASE 17): a vitrine do evento tem editor
            próprio, e o patrocínio é dado comercial — telas separadas porque
            exigem permissões diferentes (`page:manage` × `sponsor:manage`).
          */}
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/pagina`)}
            className="font-medium underline underline-offset-4"
            data-testid="landing-link"
          >
            Página pública →
          </Link>
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/patrocinadores`)}
            className="font-medium underline underline-offset-4"
            data-testid="sponsors-link"
          >
            Patrocinadores →
          </Link>
          {/*
            Palestrantes (FASE 25): cadastro da PESSOA e dos vínculos com as atividades.
            Fica ao lado da página pública porque as duas alimentam a mesma vitrine — e
            quem organiza precisa ver as duas no mesmo lugar.
          */}
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/palestrantes`)}
            className="font-medium underline underline-offset-4"
            data-testid="speakers-link"
          >
            Palestrantes →
          </Link>
          {/*
            Chamadas de propostas (FASE 33): a janela única de submissão do evento
            deu lugar a chamadas por tipo (artigo, palestrante, minicurso…), cada uma
            com o próprio prazo. Fica ao lado da página pública porque é o bloco
            "Chamadas de propostas" que a exibe.
          */}
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}/chamadas`)}
            className="font-medium underline underline-offset-4"
            data-testid="calls-link"
          >
            Chamadas de propostas →
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
              {/**
                * FASE 12 (item I3): a instituição escolhe entre evento ABERTO (padrão
                * desde a FASE 10) e restrito à própria comunidade. Sem esta caixa, a
                * FASE 10 teria tirado da instituição o direito de fechar um evento.
                */}
              <CheckboxField
                label="Exigir vínculo com a instituição para se inscrever"
                name="registrationRequiresMembership"
                hint="Desmarcado, qualquer pessoa com conta pode se inscrever (evento aberto)."
                defaultChecked={event.registrationRequiresMembership}
              />
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
                <li key={room.id} className="space-y-3 p-3 text-sm" data-testid={`room-row-${room.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="font-medium">{room.name}</span>
                    {/*
                      "sem limite" e não "0 lugares": a sala que não declara capacidade
                      não bloqueia nada, e exibir zero faria parecer o contrário.
                    */}
                    <span
                      className="code-data text-muted-foreground"
                      data-testid={`room-capacity-${room.id}`}
                    >
                      {roomCapacityLabel(room.capacity)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-start gap-3">
                    <details className="min-w-0 flex-1 rounded-lg border border-border p-2">
                      <summary className="cursor-pointer text-xs font-medium" data-testid={`edit-room-${room.id}`}>
                        Editar sala
                      </summary>

                      <AdminForm
                        action={saveRoomAction}
                        submitLabel="Salvar sala"
                        testId={`room-form-${room.id}`}
                        compact
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="roomId" value={room.id} />

                        <div className="grid gap-3 sm:grid-cols-3">
                          <Field label="Nome da sala" name="name" required defaultValue={room.name} />
                          <Field
                            label="Capacidade"
                            name="capacity"
                            type="number"
                            min={0}
                            defaultValue={room.capacity ?? ''}
                            hint="Em branco = sem limite. Com limite, a sala passa a ser o teto das vagas das atividades."
                          />
                        </div>
                      </AdminForm>
                    </details>

                    {/*
                      Excluir recusa quando alguma atividade usa a sala — e diz quantas
                      e qual. Sem a recusa, a FK `ON DELETE SET NULL` tiraria a sala da
                      programação em silêncio.
                    */}
                    <InlineActionForm
                      action={deleteRoomAction}
                      submitLabel="Excluir"
                      variant="destructive"
                      testId={`delete-room-${room.id}`}
                      confirm={{
                        title: `Excluir a sala “${room.name}”?`,
                        description:
                          'A sala sai do cadastro do evento. Só é possível excluir a sala que nenhuma atividade usa — havendo alguma, o sistema recusa e o caminho é trocar a sala dessas atividades (ou deixá-las “Sem sala definida”).',
                        confirmLabel: 'Excluir sala',
                      }}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="roomId" value={room.id} />
                    </InlineActionForm>
                  </div>
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
              {/*
                Capacidade OPCIONAL: em branco, a sala não declara limite e quem
                limita é a lotação da atividade. Antes o campo era obrigatório com
                `min=1`, e a sala sem número declarado nascia com zero lugares — um
                limite que ninguém pediu.
              */}
              <Field
                label="Capacidade"
                name="capacity"
                type="number"
                min={0}
                placeholder="Sem limite"
                hint="Em branco = sem limite definido."
              />
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
                <li key={activity.id} className="space-y-3 p-3 text-sm" data-testid={`activity-row-${activity.id}`}>
                  <div className="space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {activity.title}
                      {/**
                        * "Aberta" é a informação que muda o comportamento da inscrição —
                        * o organizador precisa vê-la na lista, e não descobrir na tela de
                        * edição. O rótulo do TIPO vem do domínio (português), nunca do
                        * enum do banco.
                        */}
                      {!activity.requiresRegistration ? (
                        <span
                          className="rounded border border-secondary/50 px-1.5 py-0.5 text-xs text-secondary-strong"
                          data-testid={`activity-open-${activity.id}`}
                        >
                          Aberta a todos os inscritos
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {activityTypeLabel(activity.type)} ·{' '}
                      {activity.startsAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                      {activity.workloadMinutes} min · {activity.roomName ?? 'sem sala'} ·{' '}
                      {activity.requiresRegistration
                        ? activitySeatsLabel(activity)
                        : 'sem controle de vagas'}
                      {activity.waitlistEnabled && activity.requiresRegistration ? ' · lista de espera' : ''} ·{' '}
                      {activityStatusLabel(activity.status)} · {activity.registrationCount} inscrito(s)
                    </p>
                    {openActivityOverflowsRoom(activity, event.registrationCount) ? (
                      <p className="text-xs text-warning-strong" data-testid={`activity-room-overflow-${activity.id}`}>
                        A sala comporta {activity.roomCapacity} lugares e o evento já tem{' '}
                        {event.registrationCount} inscrito(s): esta atividade é aberta a todos os inscritos, então
                        o público não cabe no espaço. Considere uma sala maior ou uma atividade com inscrição própria
                        e vagas limitadas.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-start gap-3">
                    {/* ── Editar: os mesmos campos da criação, preenchidos ─────── */}
                    <details className="min-w-0 flex-1 rounded-lg border border-border p-2">
                      <summary
                        className="cursor-pointer text-xs font-medium"
                        data-testid={`edit-activity-${activity.id}`}
                      >
                        Editar atividade
                      </summary>

                      <AdminForm
                        action={saveActivityAction}
                        submitLabel="Salvar atividade"
                        testId={`activity-form-${activity.id}`}
                        compact
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="eventId" value={event.id} />
                        <input type="hidden" name="activityId" value={activity.id} />

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field label="Identificador" name="slug" required defaultValue={activity.slug} />
                          <Field label="Título" name="title" required defaultValue={activity.title} />
                          <SelectField label="Tipo" name="type" options={ACTIVITY_TYPES} defaultValue={activity.type} />
                          <SelectField label="Situação" name="status" options={ACTIVITY_STATUS} defaultValue={activity.status} />
                          <SelectField label="Modalidade" name="modality" options={MODALITY} defaultValue={activity.modality} />
                          <SelectField label="Sala" name="roomId" options={roomOptions} defaultValue={activity.roomId ?? ''} />
                          <Field
                            label="Início"
                            name="startsAt"
                            type="datetime-local"
                            required
                            defaultValue={toLocalInput(activity.startsAt)}
                          />
                          <Field
                            label="Término"
                            name="endsAt"
                            type="datetime-local"
                            required
                            defaultValue={toLocalInput(activity.endsAt)}
                          />
                          <Field
                            label="Carga horária (min)"
                            name="workloadMinutes"
                            type="number"
                            min={1}
                            required
                            defaultValue={activity.workloadMinutes}
                          />
                          <Field
                            label="Vagas"
                            name="capacity"
                            type="number"
                            min={0}
                            defaultValue={activity.capacity ?? ''}
                            hint="Em branco = sem limite. A sala escolhida passa a ser o teto destas vagas."
                          />
                        </div>

                        <div className="flex flex-wrap gap-4">
                          <CheckboxField
                            label="Exige inscrição individual"
                            name="requiresRegistration"
                            defaultChecked={activity.requiresRegistration}
                          />
                          <CheckboxField
                            label="Habilitar lista de espera"
                            name="waitlistEnabled"
                            defaultChecked={activity.waitlistEnabled}
                          />
                          <CheckboxField
                            label="Destacar na página"
                            name="isFeatured"
                            defaultChecked={activity.isFeatured}
                          />
                          <CheckboxField
                            label="Habilitar credenciamento"
                            name="checkInEnabled"
                            defaultChecked={activity.checkInEnabled}
                          />
                        </div>
                      </AdminForm>
                    </details>

                    {/**
                      * Excluir recusa quando há gente inscrita ou presença — e diz o que
                      * fazer no lugar (cancelar). O diálogo do sistema explica isso antes
                      * do clique.
                      */}
                    <InlineActionForm
                      action={deleteActivityAction}
                      submitLabel="Excluir"
                      variant="destructive"
                      testId={`delete-activity-${activity.id}`}
                      confirm={{
                        title: `Excluir a atividade “${activity.title}”?`,
                        description:
                          'A atividade sai da programação. Só é possível excluir o que ainda não tem ninguém inscrito nem presença registrada — havendo, o sistema recusa e o caminho é CANCELAR a atividade, que preserva o histórico.',
                        confirmLabel: 'Excluir atividade',
                      }}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={event.id} />
                      <input type="hidden" name="activityId" value={activity.id} />
                    </InlineActionForm>
                  </div>
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
              <Field
                label="Vagas"
                name="capacity"
                type="number"
                min={0}
                hint="Em branco = sem limite. A sala escolhida passa a ser o teto destas vagas."
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <CheckboxField label="Exige inscrição individual" name="requiresRegistration" defaultChecked />
              <CheckboxField label="Habilitar lista de espera" name="waitlistEnabled" />
              <CheckboxField label="Destacar na página" name="isFeatured" />
              <CheckboxField label="Habilitar credenciamento" name="checkInEnabled" defaultChecked />
            </div>

            <p className="text-xs text-muted-foreground">
              Desmarque <strong>“Exige inscrição individual”</strong> para atividades abertas (palestra,
              mesa-redonda): quem se inscrever no evento entra nelas automaticamente, e vagas/lista de espera
              não se aplicam. Minicursos e oficinas normalmente exigem inscrição própria.
            </p>
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
                  <p className="text-xs text-muted-foreground">
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
              <legend className="px-1 text-xs uppercase tracking-wide text-muted-foreground">
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

      {/* ── Reconhecimento do comitê (FASE 16, item F1) ───────────────────── */}
      {reviewerRanking.ok ? (
        <details
          className="rounded-xl border border-border bg-card p-5"
          data-testid="reviewer-award-section"
        >
          <summary className="cursor-pointer text-base font-semibold">
            <GraduationCap className="mr-2 inline size-4" aria-hidden />
            Reconhecimento do comitê científico
          </summary>
          <div className="pt-4">
            <ReviewerAwardPanel
              tenantSlug={tenantSlug}
              eventId={eventId}
              ranking={reviewerRanking.ranked}
              minReviews={reviewerRanking.minReviews}
              cardNames={reviewerRanking.cardNames}
              reason={reviewerRanking.reason}
              canAward={canAward}
            />
          </div>
        </details>
      ) : null}
    </main>
  );
}
