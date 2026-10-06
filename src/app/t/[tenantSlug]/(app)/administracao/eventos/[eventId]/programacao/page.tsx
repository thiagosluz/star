import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CalendarRange } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { activityStatusLabel, activityTypeLabel } from '@/domain/events/activity-rules';
import { roomCapacityLabel } from '@/domain/events/event-rules';
import {
  activitySeatsLabel,
  openActivityOverflowsRoom,
  toLocalInput,
} from '@/lib/events/activity-presentation';
import { deleteActivityAction, saveActivityAction } from '@/app/actions/admin-actions';
import { SectionHeading } from '@/components/ui';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { onlineRoomFieldVisibility } from '@/domain/events/event-form-defaults';
import { EVENT_MODALITY_OPTIONS } from '@/domain/events/event-modality-rules';
import { ConfirmationFields } from '@/components/admin/confirmation-fields';
import { InlineActionForm } from '@/components/admin/inline-action-form';

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

/**
 * A lista `MODALITY` que morava AQUI virou a fonte única do domínio (FASE 69):
 * `EVENT_MODALITY_OPTIONS` (`src/domain/events/event-modality-rules.ts`). A mesma lista
 * estava nas três telas de administração — e a ATIVIDADE e o EVENTO compartilham o enum
 * `EventModality` do schema, então as duas telas nunca deveriam ter tido cópias.
 */

/**
 * A dica do campo do endereço NA ATIVIDADE.
 *
 * É diferente da do evento de propósito, e as duas estão certas: no evento, o
 * endereço é mostrado a quem tem inscrição NO EVENTO; aqui, a quem tem lugar NAQUELA
 * atividade (o minicurso fechado exige a inscrição dele; a palestra aberta recebe
 * quem se inscreveu no evento). Uma frase só para os dois mentiria num dos dois.
 */
const DICA_SALA_ONLINE_DA_ATIVIDADE =
  'Só http:// ou https://. Mostrado apenas a quem tem lugar nesta atividade (ou à equipe).';

/** O mesmo campo na CRIAÇÃO — sem endereço gravado, então só a modalidade decide. */
const SALA_ONLINE_NA_CRIACAO = onlineRoomFieldVisibility({
  modality: 'IN_PERSON',
  hint: DICA_SALA_ONLINE_DA_ATIVIDADE,
});

export const metadata = { title: 'Programação' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PROGRAMAÇÃO — AS ATIVIDADES DO EVENTO (FASE 55, fatia 4)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU PÁGINA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Era a ÚLTIMA sanfona da raiz do evento — e a maior: cada atividade tem o seu
 *  próprio painel de edição (horário, sala, vagas, confirmação de vaga por item,
 *  carga horária que conta presença e certificado). Com ela fora, a raiz fica sendo
 *  o que sempre deveria ter sido: **prontidão + mapa**.
 *
 *  O que NÃO mudou de lugar, de propósito: as telas que ORQUESTRAM a atividade —
 *  inscrições, fila de confirmações, presenças, certificados — continuam nas suas
 *  rotas. Aqui se CADASTRA a atividade; quem participa dela se inscreve, e quem a
 *  aprovou (chamada) decide convite e palestrante em `/chamadas` e no comitê.
 *
 *  O `data-testid="activities-section"` foi preservado (ADR-302) — é por ele que os
 *  specs de credenciamento, confirmação de vaga, rubricas e palestrantes navegam.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventSchedulePage({
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
   * A sala vazia é uma ESCOLHA, não um campo em branco: atividade sem sala é
   * permitida (o sistema não sabe onde ela acontece, e não inventa).
   */
  const roomOptions = [
    { value: '', label: 'Sem sala definida' },
    ...event.rooms.map((room) => ({
      value: room.id,
      label: `${room.name} (${roomCapacityLabel(room.capacity)})`,
    })),
  ];

  return (
    <main className="max-w-4xl space-y-8" data-testid="event-schedule-page">
      <div className="space-y-2">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Voltar ao evento
          </Link>
        </nav>

        <SectionHeading
          title="Programação"
          description="As atividades do evento: horário, sala, vagas e o que a presença vale."
        />
      </div>

      <section data-testid="activities-section" className="space-y-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarRange className="size-3.5 shrink-0" aria-hidden />
          A sala é o teto das vagas e o teto do horário: o sistema recusa atividade que
          atravessa outra na mesma sala.
        </p>
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
                          <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue={activity.modality} />
                          <SelectField label="Sala" name="roomId" options={roomOptions} defaultValue={activity.roomId ?? ''} />
                          {/**
                            * ───────────────────────────────────────────────────────────
                            *  O ENDEREÇO DA SALA ONLINE DA ATIVIDADE (FASE 68)
                            * ───────────────────────────────────────────────────────────
                            *  A atividade pode REPETIR o endereço do evento — repetir é
                            *  escolha do organizador, não herança: uma atividade isolada
                            *  tem a própria sala, e herdar faria esta atividade apontar
                            *  para o lugar errado no dia em que o evento trocasse o
                            *  endereço.
                            *
                            *  A PRESENÇA do campo é decidida no SERVIDOR, e olha para a
                            *  modalidade DESTA atividade — nunca a do evento: um evento
                            *  híbrido pode ter uma oficina presencial, e é a oficina que
                            *  decide se faz sentido ter sala online. O campo também
                            *  aparece quando JÁ existe endereço gravado, com a frase que
                            *  explica por que ele está ali (o organizador precisa poder
                            *  ver e limpar o que está salvo).
                            */}
                          {(() => {
                            const salaOnline = onlineRoomFieldVisibility({
                              modality: activity.modality,
                              existingUrl: activity.onlineUrl,
                              hint: DICA_SALA_ONLINE_DA_ATIVIDADE,
                            });

                            /**
                             * `show` falso = o campo NÃO é desenhado. Não há CSS
                             * escondendo nada: é a marcação que não existe, e é por isso
                             * que este formulário funciona igual sem JavaScript — a
                             * decisão é do servidor.
                             */
                            return salaOnline.show ? (
                              <Field
                                label="Endereço da sala online desta atividade"
                                name="onlineUrl"
                                type="url"
                                defaultValue={activity.onlineUrl}
                                placeholder="https://sala.exemplo.com/entrar"
                                notice={salaOnline.notice}
                                hint={salaOnline.hint}
                              />
                            ) : null;
                          })()}
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

                        {/**
                         * Confirmação de vaga (FASE 34): a escolha do organizador no
                         * cadastro. Aberta por padrão quando há pendentes, porque é o
                         * estado que exige ação — e o número de quem espera aparece no
                         * resumo da atividade logo acima.
                         */}
                        <details open={activity.pendingConfirmations > 0} className="rounded-lg border border-border p-3">
                          <summary className="cursor-pointer text-sm font-medium">
                            Confirmação de vaga
                            {activity.confirmationPolicy === 'REQUIRED'
                              ? ` · exige confirmação (${activity.confirmationWindowDays ?? 0} dia(s))`
                              : ' · automática'}
                            {activity.pendingConfirmations > 0
                              ? ` · ${activity.pendingConfirmations} aguardando`
                              : ''}
                          </summary>

                          <div className="mt-3">
                            <ConfirmationFields
                              policy={activity.confirmationPolicy}
                              windowDays={activity.confirmationWindowDays}
                              requirements={activity.confirmationRequirements}
                              place={activity.confirmationPlace}
                              instructions={activity.confirmationInstructions}
                            />
                          </div>
                        </details>
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
              <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue="IN_PERSON" />
              <SelectField label="Sala" name="roomId" options={roomOptions} />
              {/**
                * FASE 68: a sala online da atividade. Em branco = sem sala online
                * própria (o endereço do EVENTO não é herdado por esta atividade).
                *
                * Aqui o formulário CRIA a atividade, e ela nasce PRESENCIAL — o campo
                * não é desenhado (ver `SALA_ONLINE_NA_CRIACAO`). Quem escolher "Online"
                * ou "Híbrido" salva e encontra o campo no formulário de EDIÇÃO que abre
                * logo acima, já com a modalidade que escolheu.
                */}
              {SALA_ONLINE_NA_CRIACAO.show ? (
                <Field
                  label="Endereço da sala online"
                  name="onlineUrl"
                  type="url"
                  placeholder="https://sala.exemplo.com/entrar"
                  notice={SALA_ONLINE_NA_CRIACAO.notice}
                  hint={SALA_ONLINE_NA_CRIACAO.hint}
                />
              ) : null}
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

            {/**
              * A atividade NASCE com a confirmação automática (o padrão preserva o
              * comportamento de sempre). Quem quiser cobrar confirmação escolhe aqui, no
              * mesmo lugar em que escolhe vagas e lista de espera.
              */}
            <ConfirmationFields
              policy="AUTO"
              windowDays={null}
              requirements={[]}
              place={null}
              instructions={null}
            />
          </AdminForm>
        </div>
      </section>
    </main>
  );
}
