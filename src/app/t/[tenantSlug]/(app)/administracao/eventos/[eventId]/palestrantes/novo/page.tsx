import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Mic } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { withTenant } from '@/lib/db/tenant-client';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listEventActivitiesForSpeakers } from '@/lib/speakers/speaker-service';
import { saveSpeakerProfileAction } from '@/app/actions/speaker-actions';
import {
  confirmAssetUploadAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';
import { SpeakerCreateForm } from '@/components/speakers/admin-speaker-panel';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Novo palestrante' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DEDICADO DE PALESTRANTE (FASE 97 · ADR-409)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Isola o formulário de cadastro de palestrante (perfil, redes sociais, upload
 *  de foto com termo de autorização e geração de convite) em rota própria
 *  (`/palestrantes/novo`), deixando `/palestrantes` dedicado à gestão dos
 *  perfis cadastrados e de seus vínculos com as atividades do evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NewEventSpeakerPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPEAKER_MANAGE,
  });

  const data = await withTenant(tenantId, async (tx) => {
    const event = await getAdminEvent(tenantId, eventId, tx);
    if (!event) return null;

    const activities = await listEventActivitiesForSpeakers(tenantId, eventId, tx);
    return { event, activities };
  });

  if (!data) notFound();

  const { event, activities } = data;
  const activityOptions = activities.map((activity) => ({
    id: activity.id,
    title: activity.title,
  }));

  const speakersUrl = tenantPath(
    tenantSlug,
    `/administracao/eventos/${eventId}/palestrantes`,
  );

  return (
    <main className="max-w-4xl space-y-6" data-testid="new-speaker-page">
      <PageHeader
        title="Novo palestrante"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Mic className="size-6 text-primary" aria-hidden />}
        description={`Cadastre o perfil do palestrante para ${event.title}. Ao informar o e-mail, o sistema gera o código de convite para reivindicação do portal.`}
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          {
            label: event.title,
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`),
          },
          { label: 'Palestrantes', href: speakersUrl },
          { label: 'Novo palestrante' },
        ]}
      />

      <div>
        <Link
          href={speakersUrl}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-voltar-palestrantes"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Voltar para Palestrantes
        </Link>
      </div>

      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="create-speaker-section"
      >
        <div className="border-b border-border pb-3">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            Dados do palestrante
          </h2>
          <p className="text-xs text-muted-foreground">
            Preencha os dados profissionais, redes sociais e foto para a vitrine pública.
          </p>
        </div>

        <SpeakerCreateForm
          tenantSlug={tenantSlug}
          eventId={eventId}
          activities={activityOptions}
          action={saveSpeakerProfileAction}
          requestUploadAction={requestAssetUploadAction}
          confirmUploadAction={confirmAssetUploadAction}
          defaultOpen
          backHref={speakersUrl}
          backLabel="Ver palestrantes"
        />
      </section>
    </main>
  );
}

