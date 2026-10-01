import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DoorOpen } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { roomCapacityLabel } from '@/domain/events/event-rules';
import { deleteRoomAction, saveRoomAction } from '@/app/actions/admin-actions';
import { SectionHeading } from '@/components/ui';
import { AdminForm, Field } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';

export const metadata = { title: 'Salas' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  SALAS — OS ESPAÇOS FÍSICOS E A CAPACIDADE (FASE 55, fatia 3)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ISTO VIROU PÁGINA, E O QUE A SALA DECIDE
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Era a terceira sanfona da raiz do evento; virou página com cartão no grupo
 *  Configurar, como as outras áreas.
 *
 *  A capacidade da sala NÃO é enfeite: ela é o **teto das vagas** da atividade, e é
 *  aplicada na reserva atômica (revisão da FASE 3). Sala sem capacidade declarada
 *  significa "sem limite" — e é por isso que o painel de prontidão conta quantas
 *  estão assim: o organizador precisa saber disso ANTES de abrir a inscrição, não
 *  depois de a sala encher.
 *
 *  O `data-testid="rooms-section"` foi preservado (ADR-302): os specs do ciclo de
 *  vida da sala (`room-lifecycle`) e da jornada navegam por ele — o que mudou foi só
 *  o endereço onde a seção vive.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventRoomsPage({
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

  return (
    <main className="max-w-3xl space-y-8" data-testid="event-rooms-page">
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
          title="Salas"
          description="Os espaços do evento e a capacidade de cada um — a sala é o teto das vagas da atividade."
        />
      </div>

      <section data-testid="rooms-section" className="space-y-4">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <DoorOpen className="size-3.5 shrink-0" aria-hidden />
          Capacidade vazia significa <strong>sem limite</strong>: a vaga passa a ser só a da atividade.
        </p>
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
      </section>
    </main>
  );
}
