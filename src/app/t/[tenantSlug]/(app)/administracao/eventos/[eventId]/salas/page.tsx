import { notFound } from 'next/navigation';
import { DoorOpen } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { roomCapacityLabel } from '@/domain/events/event-rules';
import { deleteRoomAction, saveRoomAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { AdminForm, Field } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';

export const metadata = { title: 'Salas' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SALAS — OS ESPAÇOS FÍSICOS E A CAPACIDADE (FASE 55, fatia 3 · FASE 92)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  PADRONIZAÇÃO EM CARDS BRANCOS E CADASTRO RÁPIDO IN-PAGE (ADR-399)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A sala é uma entidade de apoio/catálogo com apenas 2 campos (nome e capacidade
 *  opcional). O organizador configura várias salas em lote ao planejar o evento.
 *  Separar em uma rota `/salas/nova` adicionaria atrito desnecessário de navegação.
 *
 *  A FASE 92 padronizou a página em dois cards brancos destacados (`bg-card
 *  rounded-xl border border-border shadow-sm`), harmonizando com as telas de
 *  eventos e programação, mantendo o cadastro in-page via Server Action instantâneo
 *  e preservando todos os seletores contratuais (`rooms-section`, `room-list`,
 *  `create-room`, etc.).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventRoomsPage({
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

  return (
    <main className="max-w-4xl space-y-8" data-testid="event-rooms-page">
      <PageHeader
        title="Salas"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="Os espaços do evento e a capacidade de cada um — a sala é o teto das vagas da atividade."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Salas' },
        ]}
      />

      <section data-testid="rooms-section" className="space-y-6">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <DoorOpen className="size-3.5 shrink-0" aria-hidden />
          Capacidade vazia significa <strong>sem limite</strong>: a vaga passa a ser só a da atividade.
        </p>

        {/* ── CARD 1: Espaços cadastrados (bg-card rounded-xl border border-border shadow-sm) ── */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Salas cadastradas ({event.rooms.length})
          </h2>

          {event.rooms.length > 0 ? (
            <ul
              className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm"
              data-testid="room-list"
            >
              {event.rooms.map((room) => (
                <li key={room.id} className="space-y-3 p-4 text-sm" data-testid={`room-row-${room.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <DoorOpen className="size-4" aria-hidden />
                      </div>
                      <span className="font-semibold text-foreground">{room.name}</span>
                    </div>

                    <span
                      className="code-data inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-mono text-muted-foreground"
                      data-testid={`room-capacity-${room.id}`}
                    >
                      {roomCapacityLabel(room.capacity)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-start gap-3 pt-1">
                    <details className="min-w-0 flex-1 rounded-lg border border-border bg-muted/20 p-3 transition-colors open:bg-muted/30">
                      <summary
                        className="cursor-pointer text-xs font-medium text-foreground hover:text-primary"
                        data-testid={`edit-room-${room.id}`}
                      >
                        Editar sala
                      </summary>

                      <div className="pt-3">
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
                      </div>
                    </details>

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
            <div
              className="rounded-xl border border-border bg-card p-8 text-center shadow-sm space-y-2"
              data-testid="rooms-empty"
            >
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <DoorOpen className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-medium text-foreground">Nenhuma sala cadastrada.</p>
              <p className="text-xs text-muted-foreground">
                Cadastre os espaços físicos do evento abaixo para definir a capacidade e associá-los às atividades.
              </p>
            </div>
          )}
        </div>

        {/* ── CARD 2: Formulário de nova sala (bg-card rounded-xl border border-border p-6 shadow-sm) ── */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="border-b border-border pb-3">
            <h2 className="text-base font-semibold text-foreground">Cadastrar nova sala</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Adicione os espaços físicos disponíveis no local do evento.
            </p>
          </div>

          <AdminForm action={saveRoomAction} submitLabel="Salvar sala" testId="create-room" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={event.id} />

            <div className="grid gap-4 sm:grid-cols-2">
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
                hint="Em branco = sem limite definido. Com limite, passa a ser o teto das vagas da atividade."
              />
            </div>
          </AdminForm>
        </div>
      </section>
    </main>
  );
}
