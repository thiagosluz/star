import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BadgeCheck, Handshake, Tags } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listSponsorBoard } from '@/lib/admin/sponsor-service';
import {
  SPONSOR_TIER_KEYS,
  SPONSOR_TIER_LABELS,
  type ContractState,
} from '@/domain/events/sponsor-rules';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { AssetUploader } from '@/components/admin/asset-uploader';
import {
  confirmAssetUploadAction,
  requestAssetUploadAction,
} from '@/app/actions/landing-actions';
import {
  deleteTierAction,
  removeSponsorAction,
  saveSponsorAction,
  saveTierAction,
  setSponsorActiveAction,
} from '@/app/actions/sponsor-actions';

export const metadata = { title: 'Patrocinadores do evento' };
export const dynamic = 'force-dynamic';

const TIER_OPTIONS = SPONSOR_TIER_KEYS.map((key) => ({
  value: key,
  label: SPONSOR_TIER_LABELS[key],
}));

/** Tom do selo de vigência — contrato vencido precisa saltar aos olhos. */
const CONTRACT_TONE: Record<ContractState, string> = {
  ACTIVE: 'text-success-strong',
  SCHEDULED: 'text-muted-foreground',
  EXPIRED: 'text-destructive',
  UNKNOWN: 'text-muted-foreground',
};

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(cents / 100);
}

function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : '';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PATROCÍNIO DO EVENTO (FASE 17, item E5)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  DUAS SEÇÕES, NESTA ORDEM: COTAS E DEPOIS PATROCINADORES
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A cota define onde o patrocinador aparece na página (Diamante no topo, Apoio no
 *  fim). Quem cadastra um patrocinador precisa ter as cotas à vista para escolher —
 *  por isso elas vêm primeiro, e o formulário de patrocinador lista as cotas pelo
 *  nome, não por um identificador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE A TELA NÃO MOSTRA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O documento fiscal (CNPJ/CPF) aparece MASCARADO. Ele é gravado, é usado pelo
 *  financeiro para conferir, e não precisa circular inteiro numa tela que fica
 *  aberta no balcão do evento.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export default async function EventSponsorsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.SPONSOR_MANAGE,
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const board = await listSponsorBoard(tenantId, eventId);
  if (!board) notFound();

  const tierChoices = [
    { value: '', label: 'Sem cota (aparece em "Patrocinadores")' },
    ...board.tiers.map((tier) => ({
      value: tier.id,
      label: `${tier.name}${tier.remaining === null ? '' : ` — ${tier.remaining} vaga(s)`}`,
    })),
  ];

  return (
    <main className="max-w-4xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="text-muted-foreground underline underline-offset-4"
          >
            ← {event.title}
          </Link>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">Patrocinadores</h1>
        <p className="text-xs text-muted-foreground" data-testid="sponsor-status">
          {board.sponsors.length} cadastrado(s) · {board.publicCount} visível(is) na página pública ·{' '}
          {board.tiers.length} cota(s)
        </p>
        <p className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}/pagina`)}
            className="underline underline-offset-4"
          >
            ← Voltar ao editor da página
          </Link>
        </p>
      </header>

      {/* ── Cotas ────────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="tier-section">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Tags className="size-4" aria-hidden />
            Cotas ({board.tiers.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            A cota define a ORDEM na página e quantos patrocinadores ela aceita.
          </p>
        </div>

        {board.tiers.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border" data-testid="tier-list">
            {board.tiers.map((tier) => (
              <li key={tier.id} data-testid={`tier-${tier.id}`} className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span
                        aria-hidden
                        className="inline-block size-3 rounded-full border border-border"
                        style={{ backgroundColor: tier.color ?? undefined }}
                      />
                      {tier.name}
                      <span className="text-xs font-normal text-muted-foreground">
                        {SPONSOR_TIER_LABELS[tier.key]} · ordem {tier.rank}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tier.sponsorCount} patrocinador(es) ·{' '}
                      {tier.maxSponsors === 0 ? 'vagas ilimitadas' : `limite ${tier.maxSponsors}`} ·{' '}
                      {tier.priceCents > 0 ? formatMoney(tier.priceCents, tier.currency) : 'sem valor definido'}
                    </p>
                    {tier.benefits.length > 0 ? (
                      <p className="text-xs text-muted-foreground">{tier.benefits.join(' · ')}</p>
                    ) : null}
                    {tier.description ? (
                      <p className="text-xs text-muted-foreground">{tier.description}</p>
                    ) : null}
                  </div>

                  <InlineActionForm
                    action={deleteTierAction}
                    submitLabel="Remover"
                    variant="destructive"
                    testId={`delete-tier-${tier.id}`}
                    confirmText={`Remover a cota "${tier.name}"?`}
                  >
                    <input type="hidden" name="tenantSlug" value={tenantSlug} />
                    <input type="hidden" name="eventId" value={eventId} />
                    <input type="hidden" name="tierId" value={tier.id} />
                  </InlineActionForm>
                </div>

                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Editar cota</summary>
                  <div className="pt-3">
                    <AdminForm action={saveTierAction} submitLabel="Salvar cota" testId={`tier-form-${tier.id}`} compact>
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="tierId" value={tier.id} />

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nome da cota" name="name" required defaultValue={tier.name} />
                        <SelectField label="Categoria" name="key" options={TIER_OPTIONS} defaultValue={tier.key} />
                        <Field label="Ordem de exibição" name="rank" type="number" min={0} defaultValue={tier.rank} />
                        <Field label="Limite de patrocinadores" name="maxSponsors" type="number" min={0} defaultValue={tier.maxSponsors} hint="0 = ilimitado" />
                        <Field label="Valor comercial (R$)" name="priceReais" defaultValue={(tier.priceCents / 100).toFixed(2)} />
                        <Field label="Moeda" name="currency" defaultValue={tier.currency} />
                        <Field label="Cor" name="color" defaultValue={tier.color} hint="Hexadecimal ou oklch()" />
                        <Field label="Descrição" name="description" defaultValue={tier.description} />
                      </div>

                      <Field
                        label="Benefícios (um por linha)"
                        name="benefits"
                        defaultValue={tier.benefits.join('\n')}
                        hint="Logo no site, estande, palestra de 10 minutos…"
                      />
                    </AdminForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="empty-tiers">
            Nenhuma cota cadastrada. Sem cotas, todo patrocinador aparece no agrupamento
            &quot;Patrocinadores&quot;.
          </p>
        )}

        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium">Nova cota</h3>
          <AdminForm action={saveTierAction} submitLabel="Criar cota" testId="create-tier" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome da cota" name="name" required placeholder="Diamante" />
              <SelectField label="Categoria" name="key" options={TIER_OPTIONS} defaultValue="CUSTOM" />
              <Field label="Ordem de exibição" name="rank" type="number" min={0} defaultValue={0} hint="Menor aparece primeiro" />
              <Field label="Limite de patrocinadores" name="maxSponsors" type="number" min={0} defaultValue={0} hint="0 = ilimitado" />
              <Field label="Valor comercial (R$)" name="priceReais" placeholder="15000,00" />
              <Field label="Moeda" name="currency" defaultValue="BRL" />
            </div>

            <Field label="Benefícios (um por linha)" name="benefits" placeholder={'Logo no site\nEstande de 9 m²'} />
          </AdminForm>
        </div>
      </section>

      {/* ── Patrocinadores ───────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-xl border border-border bg-card p-5" data-testid="sponsor-section">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Handshake className="size-4" aria-hidden />
            Patrocinadores ({board.sponsors.length})
          </h2>
          <p className="text-xs text-muted-foreground">
            Ordenados pela cota e depois pela ordem dentro da cota.
          </p>
        </div>

        {board.sponsors.length > 0 ? (
          <ul className="space-y-3" data-testid="sponsor-list">
            {board.sponsors.map((sponsor) => (
              <li
                key={sponsor.id}
                data-testid={`sponsor-${sponsor.id}`}
                data-active={sponsor.isActive ? 'true' : 'false'}
                className="space-y-3 rounded-lg border border-border p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-low">
                      {sponsor.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sponsor.logoUrl} alt={sponsor.name} className="size-full object-contain" />
                      ) : (
                        <Handshake className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </div>

                    <div className="min-w-0 space-y-0.5">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {sponsor.name}
                        {sponsor.isActive ? (
                          <span className="inline-flex items-center gap-1 text-xs text-success-strong">
                            <BadgeCheck className="size-3" aria-hidden />
                            visível
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">oculto</span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sponsor.tierName ?? 'Sem cota'} · ordem {sponsor.displayOrder}
                        {sponsor.contractValueCents
                          ? ` · ${formatMoney(sponsor.contractValueCents, 'BRL')}`
                          : ''}
                      </p>
                      <p className={`text-xs ${CONTRACT_TONE[sponsor.contractState]}`}>
                        {sponsor.contractStateLabel}
                        {sponsor.contractEnd
                          ? ` · até ${sponsor.contractEnd.toLocaleDateString('pt-BR')}`
                          : ''}
                      </p>
                      {sponsor.contactName || sponsor.contactEmail ? (
                        <p className="text-xs text-muted-foreground">
                          {sponsor.contactName ?? ''}
                          {sponsor.contactEmail ? ` · ${sponsor.contactEmail}` : ''}
                        </p>
                      ) : null}
                      {sponsor.taxIdMasked ? (
                        <p className="code-data text-xs text-muted-foreground">
                          Documento {sponsor.taxIdMasked}
                        </p>
                      ) : null}
                      {sponsor.websiteUrl ? (
                        <a
                          href={sponsor.websiteUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="text-xs underline underline-offset-4"
                        >
                          {sponsor.websiteUrl}
                        </a>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    <InlineActionForm
                      action={setSponsorActiveAction}
                      submitLabel={sponsor.isActive ? 'Ocultar' : 'Exibir'}
                      testId={`toggle-sponsor-${sponsor.id}`}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="sponsorId" value={sponsor.id} />
                      <input type="hidden" name="isActive" value={sponsor.isActive ? 'false' : 'true'} />
                    </InlineActionForm>

                    <InlineActionForm
                      action={removeSponsorAction}
                      submitLabel="Remover"
                      variant="destructive"
                      testId={`remove-sponsor-${sponsor.id}`}
                      confirmText={`Remover "${sponsor.name}" do evento? O histórico financeiro é preservado.`}
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="sponsorId" value={sponsor.id} />
                    </InlineActionForm>
                  </div>
                </div>

                <AssetUploader
                  tenantSlug={tenantSlug}
                  eventId={eventId}
                  target="SPONSOR_LOGO"
                  sponsorId={sponsor.id}
                  currentUrl={sponsor.logoUrl}
                  requestUploadAction={requestAssetUploadAction}
                  confirmUploadAction={confirmAssetUploadAction}
                />

                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-xs font-medium">Editar dados</summary>
                  <div className="pt-3">
                    <AdminForm
                      action={saveSponsorAction}
                      submitLabel="Salvar patrocinador"
                      testId={`sponsor-form-${sponsor.id}`}
                      compact
                    >
                      <input type="hidden" name="tenantSlug" value={tenantSlug} />
                      <input type="hidden" name="eventId" value={eventId} />
                      <input type="hidden" name="sponsorId" value={sponsor.id} />
                      <input type="hidden" name="logoUrl" value={sponsor.logoUrl ?? ''} />

                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Nome" name="name" required defaultValue={sponsor.name} />
                        <SelectField
                          label="Cota"
                          name="tierId"
                          options={tierChoices}
                          defaultValue={sponsor.tierId ?? ''}
                        />
                        <Field label="Site" name="websiteUrl" defaultValue={sponsor.websiteUrl} placeholder="https://empresa.com.br" />
                        <Field label="Ordem na página" name="displayOrder" type="number" min={0} defaultValue={sponsor.displayOrder} />
                        <Field label="Contato" name="contactName" defaultValue={sponsor.contactName} />
                        <Field label="E-mail do contato" name="contactEmail" type="email" defaultValue={sponsor.contactEmail} />
                        <Field label="Telefone" name="contactPhone" defaultValue={sponsor.contactPhone} />
                        <Field
                          label="CNPJ/CPF"
                          name="taxId"
                          defaultValue={sponsor.taxIdMasked ? '' : undefined}
                          placeholder={sponsor.taxIdMasked ?? 'Somente números'}
                          hint="Gravado e exibido apenas mascarado. Em branco não substitui o valor atual."
                        />
                        <Field label="Valor do contrato (R$)" name="contractValueReais" defaultValue={sponsor.contractValueCents ? (sponsor.contractValueCents / 100).toFixed(2) : undefined} />
                        <Field label="Início do contrato" name="contractStart" type="date" defaultValue={toDateInput(sponsor.contractStart)} />
                        <Field label="Fim do contrato" name="contractEnd" type="date" defaultValue={toDateInput(sponsor.contractEnd)} />
                      </div>

                      <Field label="Descrição" name="description" defaultValue={sponsor.description} />

                      <CheckboxField
                        label="Visível na página pública"
                        name="isActive"
                        defaultChecked={sponsor.isActive}
                      />
                    </AdminForm>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="empty-sponsors">
            Nenhum patrocinador cadastrado.
          </p>
        )}

        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium">Novo patrocinador</h3>
          <AdminForm action={saveSponsorAction} submitLabel="Cadastrar patrocinador" testId="create-sponsor" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />
            <input type="hidden" name="eventId" value={eventId} />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nome" name="name" required placeholder="Instituto Parceiro" />
              <SelectField label="Cota" name="tierId" options={tierChoices} defaultValue="" />
              <Field label="Site" name="websiteUrl" placeholder="https://empresa.com.br" />
              <Field label="Ordem na página" name="displayOrder" type="number" min={0} defaultValue={0} />
              <Field label="Contato" name="contactName" />
              <Field label="E-mail do contato" name="contactEmail" type="email" />
              <Field label="CNPJ/CPF" name="taxId" hint="Gravado e exibido apenas mascarado" />
              <Field label="Valor do contrato (R$)" name="contractValueReais" />
              <Field label="Início do contrato" name="contractStart" type="date" />
              <Field label="Fim do contrato" name="contractEnd" type="date" />
            </div>

            <CheckboxField
              label="Visível na página pública"
              name="isActive"
              defaultChecked
              hint="Você pode cadastrar agora e exibir quando o contrato for assinado."
            />
          </AdminForm>
        </div>
      </section>
    </main>
  );
}
