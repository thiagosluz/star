import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { requireUuidParam } from '@/lib/validation/id';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import {
  PROPOSAL_KINDS,
  PROPOSAL_KIND_LABELS,
} from '@/domain/proposals/call-rules';
import { saveCallAction } from '@/app/actions/call-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { RubricEditor } from '@/components/admin/rubric-editor';

export const metadata = { title: 'Nova chamada de propostas' };
export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  NOVA CHAMADA DE PROPOSTAS (FASE 93 · ADR-400)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PÁGINA DEDICADA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Criar uma chamada é um processo estruturado de 11 campos mais um editor
 *  aninhado de rubrica (critérios, pesos, notas máximas). Manter esse formulário
 *  dentro de um `<details>` retrátil no topo da listagem de chamadas gerava
 *  sobrecarga visual severa e empurrava a gestão para baixo.
 *
 *  A FASE 93 separou o cadastro em rota própria (/chamadas/nova), transformando
 *  /chamadas em um cockpit limpo e executivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventNewCallPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const resolvedParams = await params;
  const eventId = requireUuidParam(resolvedParams, 'eventId');
  const { tenantSlug } = resolvedParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const kindOptions = PROPOSAL_KINDS.map((kind) => ({
    value: kind,
    label: PROPOSAL_KIND_LABELS[kind],
  }));

  const trackOptions = [
    { value: '', label: 'Sem trilha (chamada não científica)' },
    ...event.tracks.map((track) => ({ value: track.id, label: track.name })),
  ];

  const blindOptions = [
    { value: '', label: 'Padrão do tipo (cego para artigo e pôster)' },
    { value: 'inherit', label: 'Herdar da trilha' },
    { value: 'on', label: 'Sim — os revisores não veem a autoria' },
    { value: 'off', label: 'Não — revisão aberta' },
  ];

  const blindHint =
    '“Padrão do tipo” grava o default do tipo na chamada (cego para artigo e pôster). ' +
    '“Herdar da trilha” deixa a chamada sem opinião: é o que faz uma trilha cega valer ' +
    'aqui — sem trilha, volta o padrão do tipo.';

  return (
    <main className="max-w-4xl space-y-8" data-testid="new-call-page">
      <PageHeader
        title="Nova chamada de propostas"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Megaphone className="size-6 text-primary" aria-hidden />}
        description="Defina as regras, prazos, critérios e formato da proposta para convidar palestrantes, artigos ou oficinas."
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Eventos', href: tenantPath(tenantSlug, '/administracao/eventos') },
          { label: event.title, href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}`) },
          {
            label: 'Chamadas de propostas',
            href: tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas`),
          },
          { label: 'Nova chamada' },
        ]}
        actions={
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas`)}
            className="text-sm underline underline-offset-4 text-muted-foreground hover:text-foreground"
          >
            ← Voltar para Chamadas
          </Link>
        }
      />

      <section
        className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-6"
        data-testid="create-call-section"
      >
        <div className="border-b border-border pb-4">
          <h2 className="text-base font-semibold text-foreground">Configuração da chamada</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Preencha as informações básicas, janela de submissão e a rubrica de avaliação do comitê.
          </p>
        </div>

        <AdminForm
          action={saveCallAction}
          submitLabel="Criar chamada"
          testId="create-call"
          backHref={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/chamadas`)}
          backLabel="Ver chamadas"
        >
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="eventSlug" value={event.slug} />
          <input type="hidden" name="eventTimezone" value={event.timezone} />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Tipo de proposta" name="kind" options={kindOptions} defaultValue="PAPER" />
            <Field
              label="Identificador na URL"
              name="slug"
              required
              hint="Minúsculas, números e hífen. É o endereço público do formulário."
            />
            <Field label="Título da chamada" name="title" required />
            <Field label="Resumo" name="summary" hint="Uma linha que a página pública mostra no cartão." />
            <div className="sm:col-span-2">
              <Field
                label="Orientações ao proponente"
                name="instructions"
                hint="O que precisa ser dito a quem vai propor: formato, critérios, o que anexar."
              />
            </div>
            <Field
              label="Abre em"
              name="opensAt"
              type="datetime-local"
              hint={`No fuso do evento (${event.timezone}).`}
            />
            <Field
              label="Encerra em"
              name="closesAt"
              type="datetime-local"
              hint={`No fuso do evento (${event.timezone}).`}
            />
            <SelectField
              label="Revisão cega"
              name="requiresBlindReview"
              options={blindOptions}
              defaultValue=""
              hint={blindHint}
            />
            <Field
              label="Propostas por autor"
              name="maxSubmissionsPerAuthor"
              type="number"
              min={0}
              defaultValue={0}
              hint="0 = sem limite."
            />
            <div className="sm:col-span-2">
              <SelectField
                label="Trilha"
                name="trackId"
                options={trackOptions}
                defaultValue=""
                hint="A trilha traz a rubrica e a afinidade dos revisores. Chamada de palestrante não precisa."
              />
            </div>
            <div className="sm:col-span-2 pt-2 border-t border-border">
              <RubricEditor criteria={[]} scope="CALL" scopeLabel="Nova chamada" testId="call-rubric" />
            </div>
          </div>
        </AdminForm>
      </section>
    </main>
  );
}

