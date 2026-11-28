import type { Metadata } from 'next';
import { CalendarPlus } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { AdminForm } from '@/components/admin/admin-form';
import { EventCreateFields } from '@/components/admin/event-create-fields';
import { saveEventAction } from '@/app/actions/admin-actions';
import { defaultEventPeriod } from '@/domain/events/event-form-defaults';
import { toLocalInput } from '@/lib/events/activity-presentation';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata: Metadata = { title: 'Novo evento' };
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

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DE NOVO EVENTO — `/t/<slug>/administracao/eventos/novo` (FASE 90)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA ROTA DEDICADA, E NÃO MODAL NEM NA LISTAGEM
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Até a FASE 89, o formulário de 17 campos convivia na mesma tela da lista de
 *  eventos (`/administracao/eventos`). Quando uma instituição acumula eventos,
 *  o formulário competia com o acervo e ficava empurrado para o rodapé.
 *
 *  A criação de evento é um ato de foco: exige datas, modalidade, fuso, URLs e
 *  regras de inscrição. Uma página dedicada oferece espaço adequado (grid de 2
 *  colunas), sem risco de perda de dados acidental por clique fora (risco de modal),
 *  com breadcrumbs semânticos e retorno nativo pelo PageHeader.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NewAdminEventPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_UPDATE,
  });

  const { startsAt: defaultStart, endsAt: defaultEnd } = defaultEventPeriod(new Date());

  return (
    <main className="max-w-4xl space-y-8">
      <PageHeader
        title="Cadastrar novo evento"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<CalendarPlus className="size-6 text-primary" aria-hidden />}
        description="Defina as informações básicas do evento. Após a criação, você poderá configurar a programação, salas, palestrantes, formulários e certificados."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: 'Novo evento' },
        ]}
      />

      <section className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm" aria-labelledby="novo-evento">
        <h2 id="novo-evento" className="text-base font-semibold tracking-tight text-foreground">
          Dados do evento
        </h2>

        <AdminForm
          action={saveEventAction}
          submitLabel="Criar evento"
          testId="create-event"
          backHref={tenantPath(tenantSlug, '/administracao/eventos')}
          backLabel="Ver eventos"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <EventCreateFields
            defaultStartLocal={toLocalInput(defaultStart)}
            defaultEndLocal={toLocalInput(defaultEnd)}
            statusOptions={STATUS_LABELS}
          />
        </AdminForm>
      </section>
    </main>
  );
}

