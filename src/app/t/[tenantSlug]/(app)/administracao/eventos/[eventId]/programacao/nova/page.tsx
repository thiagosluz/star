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
import { AdminForm } from '@/components/admin/admin-form';
import { ActivityCreateFields } from '@/components/admin/activity-create-fields';

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

        <AdminForm
          action={saveActivityAction}
          submitLabel="Criar atividade"
          testId="create-activity"
          backHref={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/programacao`)}
          backLabel="Ver programação"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={event.id} />

          <ActivityCreateFields
            activityTypes={ACTIVITY_TYPES}
            activityStatus={ACTIVITY_STATUS}
            roomOptions={roomOptions}
            hasRooms={event.rooms.length > 0}
            roomsHref={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/salas`)}
            defaultStartLocal={toLocalInput(event.startsAt)}
            defaultEndLocal={toLocalInput(defaultEnd)}
          />
        </AdminForm>
      </section>
    </main>
  );
}

