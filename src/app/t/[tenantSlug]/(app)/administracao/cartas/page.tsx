import Link from 'next/link';
import { Layers } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RARITY_LABELS, resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import { CARD_RARITIES, CARD_TRIGGERS } from '@/domain/gamification/types';
import { listCardTemplates } from '@/lib/admin/gamification-admin-service';
import { listAdminEvents } from '@/lib/admin/catalog-service';
import { withTenant } from '@/lib/db/tenant-client';
import { CardVisual } from '@/components/gamification/card-visual';
import { AdminForm, CheckboxField, Field, SelectField } from '@/components/admin/admin-form';
import { saveCardTemplateAction } from '@/app/actions/admin-actions';
import { grantCardAction } from '@/app/actions/gamification-actions';

export const metadata = { title: 'Cartas' };
export const dynamic = 'force-dynamic';

const RARITY_OPTIONS = CARD_RARITIES.map((rarity) => ({ value: rarity, label: RARITY_LABELS[rarity] }));

const TRIGGER_LABELS: Record<string, string> = {
  CHECKIN: 'Credenciamento',
  ACTIVITY_COMPLETION: 'Presença em atividade',
  MINI_COURSE_COMPLETION: 'Conclusão de minicurso',
  SUBMISSION_SUBMITTED: 'Trabalho submetido',
  SUBMISSION_ACCEPTED: 'Trabalho aceito',
  REVIEW_COMPLETED: 'Parecer concluído',
  REVIEWER_TOP: 'Melhor revisor (manual)',
  XP_THRESHOLD: 'Limiar de XP',
  LEVEL_UP: 'Subida de nível',
  MANUAL_GRANT: 'Concessão manual',
  STREAK: 'Ofensiva (dias seguidos)',
  EVENT_ATTENDANCE_FULL: 'Presença em todo o evento',
};

/**
 * Catálogo de cartas.
 *
 * Cada carta aparece RENDERIZADA com a paleta real: o organizador precisa ver o
 * que está criando. Uma tabela de códigos hexadecimais não diz se a carta ficou
 * legível — e o participante é quem descobriria isso, sem poder reclamar.
 */
export default async function AdminCardsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });

  const [cards, events, participants] = await Promise.all([
    listCardTemplates(tenantId),
    listAdminEvents(tenantId),
    withTenant(tenantId, (tx) =>
      tx.userTenantProfile.findMany({
        where: { tenantId, status: 'ACTIVE', deletedAt: null },
        orderBy: { joinedAt: 'asc' },
        take: 200,
        select: { user: { select: { id: true, name: true } } },
      }),
    ),
  ]);

  const eventOptions = [
    { value: '', label: 'Carta do tenant (qualquer evento)' },
    ...events.map((event) => ({ value: event.id, label: event.title })),
  ];

  const triggerOptions = CARD_TRIGGERS.map((trigger) => ({
    value: trigger,
    label: TRIGGER_LABELS[trigger] ?? trigger,
  }));

  return (
    <main className="max-w-5xl space-y-8">
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
          <Layers className="size-6 text-tier-epic" aria-hidden />
          Cartas colecionáveis
        </h1>
        <p className="text-sm text-muted-foreground">
          A paleta e a arte são validadas ao salvar: cores fora do formato (hex ou <span className="code-data">oklch()</span>)
          e URLs não-http(s) são descartadas.
        </p>
      </header>

      <section className="space-y-4" aria-labelledby="catalogo">
        <h2 id="catalogo" className="text-lg font-semibold tracking-tight">
          Catálogo ({cards.length})
        </h2>

        {cards.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground" data-testid="cards-empty">
            Nenhuma carta cadastrada.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="admin-card-list">
            {cards.map((card) => (
              <li key={card.id} className="flex gap-4 rounded-xl border border-border bg-card p-4">
                <CardVisual
                  name={card.name}
                  rarity={card.rarity}
                  palette={resolvePalette(card.palette, card.rarity)}
                  imageUrl={resolveArt(card.art).imageUrl}
                  size="sm"
                />

                <div className="min-w-0 space-y-1 text-xs">
                  <p className="text-sm font-medium">{card.name}</p>
                  <p className="text-muted-foreground">
                    {RARITY_LABELS[card.rarity]} · {TRIGGER_LABELS[card.trigger] ?? card.trigger}
                  </p>
                  <p className="text-muted-foreground">
                    nível {card.levelRequired} · peso {card.trigger ? '' : ''}
                    {card.maxSupply === 0 ? 'tiragem ilimitada' : `tiragem ${card.mintedCount}/${card.maxSupply}`}
                  </p>
                  <p className="text-muted-foreground">
                    {card.ownedBy} no álbum de participantes · {card.isActive ? 'ativa' : 'inativa'}
                    {card.isSecret ? ' · secreta' : ''}
                  </p>
                  <p className="code-data text-muted-foreground">{card.slug}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="nova-carta">
        <h2 id="nova-carta" className="text-lg font-semibold tracking-tight">
          Nova carta
        </h2>

        <AdminForm action={saveCardTemplateAction} submitLabel="Criar carta" testId="create-card">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Identificador" name="slug" required placeholder="guardiao-do-metodo" />
            <Field label="Nome" name="name" required placeholder="Guardião do Método" />
            <Field label="Descrição" name="description" placeholder="Concedida por concluir um parecer" />
            <Field label="História (lore)" name="lore" placeholder="O trabalho invisível que sustenta a ciência" />
            <SelectField label="Raridade" name="rarity" options={RARITY_OPTIONS} defaultValue="COMMON" />
            <SelectField label="Gatilho" name="trigger" options={triggerOptions} defaultValue="CHECKIN" />
            <SelectField label="Evento" name="eventId" options={eventOptions} />
            <Field label="Nível mínimo" name="levelRequired" type="number" min={1} defaultValue={1} />
            <Field label="Peso no sorteio" name="dropWeight" type="number" min={1} defaultValue={100} hint="Maior = mais comum" />
            <Field label="Tiragem (0 = ilimitada)" name="maxSupply" type="number" min={0} defaultValue={0} />
            <Field label="Cor primária" name="palettePrimary" placeholder="#7c3aed" />
            <Field label="Cor secundária" name="paletteSecondary" placeholder="#3b0764" />
            <Field label="Cor de brilho" name="paletteGlow" placeholder="#c084fc" />
            <Field label="Cor do texto" name="paletteText" placeholder="#faf5ff" />
            <Field label="URL da arte" name="artImageUrl" placeholder="https://..." />
            <SelectField
              label="Animação"
              name="artAnimation"
              options={[
                { value: 'none', label: 'Nenhuma' },
                { value: 'shimmer', label: 'Brilho' },
                { value: 'float', label: 'Flutuar' },
                { value: 'pulse', label: 'Pulsar' },
              ]}
              defaultValue="none"
            />
            <SelectField
              label="Partículas"
              name="artParticle"
              options={[
                { value: 'none', label: 'Nenhuma' },
                { value: 'sparkle', label: 'Faíscas' },
                { value: 'dust', label: 'Poeira' },
                { value: 'orbit', label: 'Órbita' },
              ]}
              defaultValue="none"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Limiar de XP" name="conditionThreshold" type="number" min={0} hint="Só para gatilho de limiar" />
            <Field label="Dias de ofensiva" name="conditionStreak" type="number" min={2} hint="Só para gatilho de ofensiva" />
            <Field label="Nível do gatilho" name="conditionLevel" type="number" min={2} hint="Só para subida de nível" />
          </div>

          <div className="flex flex-wrap gap-4">
            <CheckboxField label="Carta ativa" name="isActive" defaultChecked />
            <CheckboxField label="Carta secreta" name="isSecret" hint="Some do álbum até ser conquistada" />
          </div>
        </AdminForm>
      </section>

      {participants.length > 0 ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-labelledby="conceder">
          <h2 id="conceder" className="text-lg font-semibold tracking-tight">
            Conceder carta manualmente
          </h2>
          <p className="text-xs text-muted-foreground">
            A concessão respeita nível exigido, janela de disponibilidade e tiragem — um passe livre administrativo
            criaria cartas além do limite e destruiria a escassez da coleção.
          </p>

          <AdminForm action={grantCardAction} submitLabel="Conceder" testId="grant-card" compact>
            <input type="hidden" name="tenantSlug" value={tenantSlug} />

            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                label="Participante"
                name="userId"
                options={participants.map((row) => ({ value: row.user.id, label: row.user.name }))}
              />
              <SelectField
                label="Carta"
                name="cardTemplateId"
                options={cards.map((card) => ({ value: card.id, label: `${card.name} (${RARITY_LABELS[card.rarity]})` }))}
              />
              <Field label="Motivo" name="reason" placeholder="Premiação da hackathon" />
            </div>
          </AdminForm>
        </section>
      ) : null}
    </main>
  );
}
