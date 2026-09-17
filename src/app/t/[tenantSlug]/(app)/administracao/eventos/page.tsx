import Link from 'next/link';
import { CalendarPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { saveEventAction } from '@/app/actions/admin-actions';

export const metadata = { title: 'Eventos' };
export const dynamic = 'force-dynamic';

const STATUS_LABELS = [
  { value: 'DRAFT', label: 'Rascunho' },
  { value: 'PUBLISHED', label: 'Publicado' },
  { value: 'REGISTRATION_OPEN', label: 'Inscrições abertas' },
  { value: 'REGISTRATION_CLOSED', label: 'Inscrições encerradas' },
  { value: 'IN_PROGRESS', label: 'Em andamento' },
  { value: 'FINISHED', label: 'Encerrado' },
  { value: 'CANCELED', label: 'Cancelado' },
  { value: 'ARCHIVED', label: 'Arquivado' },
];

const MODALITY_LABELS = [
  { value: 'IN_PERSON', label: 'Presencial' },
  { value: 'ONLINE', label: 'Online' },
  { value: 'HYBRID', label: 'Híbrido' },
];

/** Datas em `datetime-local` exigem `YYYY-MM-DDTHH:mm` (sem timezone). */
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function AdminEventsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const events = await listAdminEvents(tenantId);

  const now = new Date();
  const defaultStart = new Date(now.getTime() + 30 * 86_400_000);

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, '/administracao')}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← Administração
          </Link>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CalendarPlus className="size-6 text-primary" aria-hidden />
          Eventos
        </h1>
        <p className="text-sm text-muted-foreground">
          O evento é a raiz de tudo: atividades, salas, chamada de trabalhos, inscrições e certificados
          pertencem a ele.
        </p>
      </header>

      <section className="space-y-3" aria-labelledby="lista-eventos">
        <h2 id="lista-eventos" className="text-lg font-semibold tracking-tight">
          Eventos da instituição
        </h2>

        {events.length === 0 ? (
          <p
            className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground"
            data-testid="events-empty"
          >
            Nenhum evento cadastrado. Crie o primeiro no formulário abaixo.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card" data-testid="admin-event-list">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">/t/{tenantSlug}/eventos/{event.slug}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.startsAt.toLocaleDateString('pt-BR')} · {event.status} ·{' '}
                    {event.activityCount} atividade(s) · {event.trackCount} trilha(s) ·{' '}
                    {event.roomCount} sala(s) · {event.registrationCount} inscrição(ões)
                  </p>
                </div>

                <Link
                  href={tenantPath(tenantSlug, `/administracao/eventos/${event.id}`)}
                  data-testid={`manage-${event.slug}`}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted"
                >
                  Gerenciar
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="novo-evento">
        <h2 id="novo-evento" className="text-lg font-semibold tracking-tight">
          Novo evento
        </h2>

        <AdminForm action={saveEventAction} submitLabel="Criar evento" testId="create-event">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador (URL)" name="slug" required placeholder="congresso-2027" />
            <Field label="Título" name="title" required placeholder="Congresso de Tecnologia 2027" />
            <Field label="Resumo" name="summary" placeholder="Uma linha sobre o evento" />
            <Field label="Local" name="venueName" placeholder="Centro de Convenções" />
            <Field label="Cidade" name="city" placeholder="Salvador" />
            <Field label="UF" name="state" placeholder="BA" />
            <Field label="Início" name="startsAt" type="datetime-local" required defaultValue={toLocalInput(defaultStart)} />
            <Field
              label="Término"
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={toLocalInput(new Date(defaultStart.getTime() + 3 * 86_400_000))}
            />
            <Field label="Fuso horário" name="timezone" required defaultValue="America/Bahia" />
            <Field label="Vagas (vazio = ilimitado)" name="capacity" type="number" min={0} />
            <Field label="Cor principal" name="primaryColor" placeholder="#1d4ed8" hint="Hexadecimal ou oklch()" />
            <Field label="Inscrições abrem em" name="registrationOpensAt" type="datetime-local" />
            <Field label="Inscrições fecham em" name="registrationClosesAt" type="datetime-local" />
            <Field label="Chamada de trabalhos abre" name="cfpOpensAt" type="datetime-local" />
            <Field label="Chamada de trabalhos fecha" name="cfpClosesAt" type="datetime-local" />
            <SelectField label="Situação" name="status" options={STATUS_LABELS} defaultValue="DRAFT" />
            <SelectField label="Modalidade" name="modality" options={MODALITY_LABELS} defaultValue="IN_PERSON" />
          </div>
        </AdminForm>
      </section>
    </main>
  );
}
