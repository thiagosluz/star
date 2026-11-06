import { notFound } from 'next/navigation';
import { CalendarPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { roomCapacityLabel } from '@/domain/events/event-rules';
import { toLocalInput } from '@/lib/events/activity-presentation';
import { saveActivityAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { onlineRoomFieldVisibility } from '@/domain/events/event-form-defaults';
import { EVENT_MODALITY_OPTIONS } from '@/domain/events/event-modality-rules';
import { ConfirmationFields } from '@/components/admin/confirmation-fields';

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

const DICA_SALA_ONLINE_DA_ATIVIDADE =
  'Só http:// ou https://. Mostrado apenas a quem tem lugar nesta atividade (ou à equipe).';

const SALA_ONLINE_NA_CRIACAO = onlineRoomFieldVisibility({
  modality: 'IN_PERSON',
  hint: DICA_SALA_ONLINE_DA_ATIVIDADE,
});

export const metadata = { title: 'Nova atividade' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DE NOVA ATIVIDADE (FASE 91 · ADR-398)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA DEDICADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O formulário de cadastro de atividade morava no rodapé da listagem de
 *  programação — abaixo de dezenas de atividades e dos formulários de edição
 *  in-place. Isso causava sobrecarga cognitiva, scroll excessivo e quebrava o
 *  padrão visual estabelecido na FASE 90.
 *
 *  A criação agora vive em sua própria rota como Server Component puro, com
 *  PageHeader semântico, volta nativa por breadcrumb e o formulário encapsulado
 *  no card padrão da plataforma (`rounded-xl border border-border bg-card p-6 shadow-sm`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NewActivityPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const roomOptions = [
    { value: '', label: 'Sem sala definida' },
    ...event.rooms.map((room) => ({
      value: room.id,
      label: `${room.name} (${roomCapacityLabel(room.capacity)})`,
    })),
  ];

  const defaultEnd = new Date(event.startsAt.getTime() + 3_600_000);

  return (
    <main className="max-w-4xl space-y-8" data-testid="new-activity-page">
      <PageHeader
        title="Cadastrar nova atividade"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<CalendarPlus className="size-6 text-primary" aria-hidden />}
        description={`Adicione uma palestra, minicurso, oficina ou mesa-redonda à grade de ${event.title}.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Programação', href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}/programacao`) },
          { label: 'Nova atividade' },
        ]}
      />

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        aria-labelledby="nova-atividade"
      >
        <h2 id="nova-atividade" className="text-base font-semibold tracking-tight text-foreground">
          Dados da atividade
        </h2>

        <AdminForm action={saveActivityAction} submitLabel="Criar atividade" testId="create-activity">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={event.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador" name="slug" required placeholder="minicurso-rust" />
            <Field label="Título" name="title" required placeholder="Minicurso: Rust para iniciantes" />
            <SelectField label="Tipo" name="type" options={ACTIVITY_TYPES} defaultValue="LECTURE" />
            <SelectField label="Situação" name="status" options={ACTIVITY_STATUS} defaultValue="SCHEDULED" />
            <SelectField label="Modalidade" name="modality" options={EVENT_MODALITY_OPTIONS} defaultValue="IN_PERSON" />
            <SelectField label="Sala" name="roomId" options={roomOptions} />

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
            <Field label="Término" name="endsAt" type="datetime-local" required defaultValue={toLocalInput(defaultEnd)} />
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

          <ConfirmationFields
            policy="AUTO"
            windowDays={null}
            requirements={[]}
            place={null}
            instructions={null}
          />
        </AdminForm>
      </section>
    </main>
  );
}

