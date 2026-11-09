import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Copy, Handshake } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listSponsorBoard, listSponsorCandidates } from '@/lib/admin/sponsor-service';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { copySponsorAction, saveSponsorAction } from '@/app/actions/sponsor-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';

export const metadata = { title: 'Novo patrocinador' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  CADASTRO DEDICADO DE PATROCINADOR (FASE 94 · ADR-401)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Isola o formulário denso de patrocinador (12+ campos de cadastro, contrato e
 *  contato) e a opção de cópia de outra edição em uma página própria, eliminando
 *  o "efeito torre" e a sobrecarga cognitiva do cockpit `/patrocinadores`.
 *
 *  O container segue o padrão de card branco elevado (`rounded-xl border border-border
 *  bg-card p-6 shadow-sm`) do design system da plataforma.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function NewSponsorPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const board = await listSponsorBoard(tenantId, eventId);
  if (!board) notFound();

  const candidates = await listSponsorCandidates(tenantId, eventId);

  const tierChoices = [
    { value: '', label: 'Sem cota (aparece em "Patrocinadores")' },
    ...board.tiers.map((tier) => ({
      value: tier.id,
      label: `${tier.name}${tier.remaining === null ? '' : ` — ${tier.remaining} vaga(s)`}`,
    })),
  ];

  const candidateOptions = [
    {
      value: '',
      label:
        candidates.length > 0
          ? 'Selecione um patrocinador…'
          : 'Nenhum patrocinador em outros eventos',
    },
    ...candidates.map((candidate) => ({
      value: candidate.sponsorId,
      label: candidate.alreadyInEvent
        ? `${candidate.name} (já está neste evento)`
        : `${candidate.name}${candidate.tierName ? ` — ${candidate.tierName}` : ''} · ${candidate.events.length} evento(s)`,
    })),
  ];

  const sponsorsUrl = tenantPath(
    tenantSlug,
    `/administracao/eventos/${eventId}/patrocinadores`,
  );

  return (
    <main className="max-w-4xl space-y-8" data-testid="new-sponsor-page">
      <PageHeader
        title="Novo patrocinador"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        description="Cadastre uma empresa parceira para este evento ou copie o cadastro de uma edição anterior."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          { label: 'Patrocinadores', href: sponsorsUrl },
          { label: 'Novo patrocinador' },
        ]}
      />

      <p className="text-xs">
        <Link href={sponsorsUrl} className="underline underline-offset-4">
          ← Voltar para Patrocinadores
        </Link>
      </p>

      {/* Formulário Principal: Cadastrar Patrocinador */}
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="create-sponsor-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Handshake className="size-5 text-primary" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Dados do patrocinador</h2>
            <p className="text-xs text-muted-foreground">
              Preencha os dados institucionais e comerciais da empresa apoiadora.
            </p>
          </div>
        </div>

        <AdminForm
          action={saveSponsorAction}
          submitLabel="Cadastrar patrocinador"
          testId="create-sponsor"
          backHref={sponsorsUrl}
          backLabel="Ver patrocinadores"
          compact
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" name="name" required placeholder="Instituto Parceiro" />
            <SelectField label="Cota" name="tierId" options={tierChoices} defaultValue="" />
            <Field label="Site" name="websiteUrl" placeholder="https://empresa.com.br" />
            <Field
              label="Ordem na página"
              name="displayOrder"
              type="number"
              min={0}
              defaultValue={0}
            />
            <Field label="Contato" name="contactName" />
            <Field label="E-mail do contato" name="contactEmail" type="email" />
            <Field
              label="CNPJ/CPF"
              name="taxId"
              hint="Gravado e exibido apenas mascarado"
            />
            <Field label="Valor do contrato (R$)" name="contractValueReais" />
            <Field label="Início do contrato" name="contractStart" type="date" />
            <Field label="Fim do contrato" name="contractEnd" type="date" />
          </div>

          <Field
            label="Descrição"
            name="description"
            placeholder="Breve apresentação institucional do patrocinador"
          />

          <CheckboxField
            label="Visível na página pública"
            name="isActive"
            defaultChecked
            hint="Você pode cadastrar agora e exibir quando o contrato for assinado."
          />
        </AdminForm>
      </section>

      {/* Formulário Secundário: Copiar de Outro Evento */}
      <section
        className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        data-testid="copy-sponsor-section"
      >
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Copy className="size-5 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="text-base font-semibold">Copiar de outro evento</h2>
            <p className="text-xs text-muted-foreground">
              Copiar traz nome, site, contato, documento e logotipo. O cadastro entra{' '}
              <strong>oculto e sem valor de contrato</strong>: cada edição tem o seu, e
              exibir de imediato publicaria uma marca ainda não fechada.
            </p>
          </div>
        </div>

        <AdminForm
          action={copySponsorAction}
          submitLabel="Copiar para este evento"
          testId="copy-sponsor"
          backHref={sponsorsUrl}
          backLabel="Ver patrocinadores"
          compact
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <SelectField
            label="Patrocinador"
            name="sourceSponsorId"
            options={candidateOptions}
            defaultValue=""
            hint="A cota é casada pela categoria (Ouro → Ouro). Sem correspondência, o cadastro entra sem cota."
          />
        </AdminForm>
      </section>
    </main>
  );
}

