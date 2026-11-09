import Link from 'next/link';
import { ArrowLeft, Layers } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { AdminForm } from '@/components/admin/admin-form';
import { saveCardTemplateAction } from '@/app/actions/admin-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { CardFormFields, TRIGGER_OPTIONS } from '@/components/gamification/card-form-fields';

export const metadata = { title: 'Nova carta colecionável' };
export const dynamic = 'force-dynamic';

export default async function NovaCartaPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });

  const events = await listAdminEvents(tenantId);

  const eventOptions = [
    { value: '', label: 'Carta da instituição (qualquer evento)' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  return (
    <main className="max-w-4xl space-y-6">
      <PageHeader
        title="Nova carta colecionável"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Layers className="size-6 text-tier-epic" aria-hidden />}
        description={
          <>
            Cadastre uma nova carta no catálogo da instituição com regras de conquista,
            paleta de cores, arte personalizada e efeitos holográficos 3D.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Cartas colecionáveis', href: tenantPath(tenantSlug, '/administracao/cartas') },
          { label: 'Nova carta' },
        ]}
      />

      <div>
        <Link
          href={tenantPath(tenantSlug, '/administracao/cartas')}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-voltar-cartas"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para o catálogo de cartas
        </Link>
      </div>

      <section
        className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="create-card-section"
      >
        <div className="border-b border-border pb-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Definição da carta
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cores fora do formato (hexadecimal ou <span className="code-data">oklch()</span>) e URLs
            inválidas são descartadas automaticamente na validação.
          </p>
        </div>

        <AdminForm
          action={saveCardTemplateAction}
          submitLabel="Criar carta"
          testId="create-card"
          backHref={tenantPath(tenantSlug, '/administracao/cartas')}
          backLabel="Ver cartas"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <CardFormFields
            triggerOptions={TRIGGER_OPTIONS}
            eventOptions={eventOptions}
            structured
          />
        </AdminForm>
      </section>
    </main>
  );
}

