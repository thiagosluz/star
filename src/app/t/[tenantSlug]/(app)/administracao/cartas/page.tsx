import Link from 'next/link';
import { ArchiveRestore, Layers, Pencil, Plus, Search } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RARITY_LABELS, resolveArt, resolvePalette } from '@/domain/gamification/card-rules';
import {
  CATALOG_SCOPE_LABELS,
  catalogScopeFromQuery,
  catalogScopeToggleLabel,
} from '@/domain/gamification/catalog-rules';
import { cardBackContent, resolveCardStage } from '@/domain/gamification/card-presentation';
import { formatZonedDateTime } from '@/domain/events/scheduling-rules';
import { listCardTemplates } from '@/lib/admin/gamification-admin-service';
import { withTenant } from '@/lib/db/tenant-client';
import { HoloCard } from '@/components/gamification/holo-card';
import { AdminForm, Field, SelectField } from '@/components/admin/admin-form';
import { InlineActionForm } from '@/components/admin/inline-action-form';
import { deleteCardTemplateAction } from '@/app/actions/admin-actions';
import { restoreCardTemplateAction } from '@/app/actions/catalog-archive-actions';
import { grantCardAction } from '@/app/actions/gamification-actions';
import { PageHeader } from '@/components/ui';
import { TENANT_NAV_GROUPS } from '@/components/shell/tenant-nav';
import { TRIGGER_LABELS } from '@/components/gamification/card-form-fields';

export const metadata = { title: 'Cartas' };
export const dynamic = 'force-dynamic';

const PARTICIPANT_SELECT_LIMIT = 200;

/**
 * Catálogo de cartas (FASE 43 · FASE 95 · FASE 96).
 *
 * Cada carta aparece RENDERIZADA com a paleta real: o organizador precisa ver o
 * que está criando. Uma tabela de códigos hexadecimais não diz se a carta ficou
 * legível — e o participante é quem descobriria isso, sem poder reclamar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  TRANSAÇÃO ÚNICA E DESACOPLAMENTO DA EDIÇÃO (FASE 96 · ADR-403 / ADR-404)
 * ─────────────────────────────────────────────────────────────────────────────
 *  1. Todas as leituras desta página rodam em UMA única transação `withTenant`
 *     (fuso da instituição, catálogo de cartas e participantes da concessão
 *     manual), ocupando 1 conexão do pool em vez de 4 conexões concorrentes.
 *  2. O formulário de edição (26 campos + seletor de eventos) saiu do `<details>`
 *     repetido em cada `<li>` e virou rota dedicada (`/administracao/cartas/[cardId]/editar`),
 *     reduzindo o payload de O(cartas × eventos) para O(cartas).
 *  3. O seletor de participantes na concessão manual deixou de truncar em 200
 *     em silêncio: conta o total real, avisa quando há recorte e oferece busca
 *     por GET (`?participante=`) que funciona sem JavaScript.
 */
export default async function AdminCardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string }>;
  searchParams: Promise<{ arquivados?: string; participante?: string }>;
}) {
  const { tenantSlug } = await params;
  const { arquivados, participante } = await searchParams;

  const scope = catalogScopeFromQuery(arquivados);
  const arquivando = scope === 'ARQUIVADOS';
  const buscaParticipante = typeof participante === 'string' ? participante.trim() : '';

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.CARD_TEMPLATE_MANAGE,
  });

  const { timezone, cards, participants, totalParticipants } = await withTenant(
    tenantId,
    async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });

      const loadedCards = await listCardTemplates(tenantId, scope, tx);

      if (arquivando) {
        return {
          timezone: tenant?.timezone ?? 'UTC',
          cards: loadedCards,
          participants: [] as { user: { id: string; name: string } }[],
          totalParticipants: 0,
        };
      }

      const participantWhere = {
        tenantId,
        status: 'ACTIVE' as const,
        deletedAt: null,
        ...(buscaParticipante
          ? {
              user: {
                OR: [
                  { name: { contains: buscaParticipante, mode: 'insensitive' as const } },
                  { email: { contains: buscaParticipante, mode: 'insensitive' as const } },
                ],
              },
            }
          : {}),
      };

      const loadedParticipants = await tx.userTenantProfile.findMany({
        where: participantWhere,
        orderBy: { joinedAt: 'asc' },
        take: PARTICIPANT_SELECT_LIMIT,
        select: { user: { select: { id: true, name: true } } },
      });

      const total =
        typeof tx.userTenantProfile.count === 'function'
          ? await tx.userTenantProfile.count({ where: participantWhere })
          : loadedParticipants.length;

      return {
        timezone: tenant?.timezone ?? 'UTC',
        cards: loadedCards,
        participants: loadedParticipants,
        totalParticipants: total,
      };
    },
  );

  return (
    <main className="max-w-5xl space-y-8">
      <PageHeader
        title="Cartas colecionáveis"
        eyebrow={TENANT_NAV_GROUPS.operacao}
        icon={<Layers className="size-6 text-tier-epic" aria-hidden />}
        description={
          <>
            A paleta e a arte são validadas ao salvar: cores fora do formato (hex ou <span className="code-data">oklch()</span>)
            e URLs não-http(s) são descartadas.
          </>
        }
        breadcrumbs={[
          { label: 'Painel', href: tenantPath(tenantSlug, '/dashboard') },
          { label: 'Administração', href: tenantPath(tenantSlug, '/administracao') },
          { label: 'Cartas colecionáveis' },
        ]}
        actions={
          arquivando ? undefined : (
            <Link
              href={tenantPath(tenantSlug, '/administracao/cartas/nova')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-testid="btn-nova-carta"
            >
              <Plus className="size-4" aria-hidden />
              Nova carta
            </Link>
          )
        }
      />

      {/*
        O FILTRO É UM LINK — sem JavaScript, com endereço próprio e sem estado escondido.
        Ele fica FORA da seção da lista porque vale para as duas vistas: é o mesmo
        catálogo, lido de outro ângulo.
      */}
      <nav className="flex flex-wrap items-center gap-3 text-sm" aria-label="Escopo do catálogo">
        <Link
          href={
            arquivando
              ? tenantPath(tenantSlug, '/administracao/cartas')
              : `${tenantPath(tenantSlug, '/administracao/cartas')}?arquivados=1`
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
          data-testid="cards-archive-toggle"
          aria-current={arquivando ? 'page' : undefined}
        >
          <ArchiveRestore className="size-4" aria-hidden />
          {catalogScopeToggleLabel(scope)}
        </Link>
        <span className="text-xs text-muted-foreground" data-testid="cards-scope-label">
          {CATALOG_SCOPE_LABELS[scope]}
        </span>
      </nav>

      <section className="space-y-4" aria-labelledby="catalogo">
        <div className="flex items-center justify-between">
          <h2 id="catalogo" className="text-lg font-semibold tracking-tight">
            {arquivando ? `Arquivadas (${cards.length})` : `Catálogo (${cards.length})`}
          </h2>
        </div>

        {cards.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card p-10 text-center shadow-sm"
            data-testid="cards-empty"
          >
            <Layers className="size-10 text-muted-foreground/50 mb-3" aria-hidden />
            <h3 className="text-base font-medium text-foreground">
              {arquivando ? 'Nenhuma carta arquivada' : 'Nenhuma carta cadastrada'}
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              {arquivando
                ? 'O que for excluído aparece aqui, com a data e o autor da exclusão.'
                : 'Cadastre cartas colecionáveis com artes e efeitos holográficos para recompensar seus participantes.'}
            </p>
            {!arquivando && (
              <div className="mt-5">
                <Link
                  href={tenantPath(tenantSlug, '/administracao/cartas/nova')}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
                  data-testid="btn-empty-nova-carta"
                >
                  <Plus className="size-4" aria-hidden />
                  Criar primeira carta
                </Link>
              </div>
            )}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2" data-testid="admin-card-list">
            {cards.map((card) => {
              const art = resolveArt(card.art);

              return (
                <li
                  key={card.id}
                  className="flex flex-col justify-between space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                  data-testid={`admin-card-${card.id}`}
                >
                  <div className="flex gap-4">
                    <HoloCard
                      name={card.name}
                      rarity={card.rarity}
                      palette={resolvePalette(card.palette, card.rarity)}
                      imageUrl={art.imageUrl}
                      backArtUrl={art.backUrl}
                      isFoil={art.foil}
                      stage={resolveCardStage({
                        art,
                        isFoil: art.foil,
                        rarity: card.rarity,
                      })}
                      back={cardBackContent({
                        rarity: card.rarity,
                        trigger: card.trigger,
                        description: card.description ?? null,
                        lore: card.lore ?? null,
                        quantity: 1,
                        isFoil: false,
                        level: 1,
                        grantedAt: null,
                        timezone,
                      })}
                      variant="hover"
                      size="sm"
                    />

                    <div className="min-w-0 space-y-1 text-xs">
                      <p className="text-sm font-medium text-foreground">{card.name}</p>
                      <p className="text-muted-foreground">
                        {RARITY_LABELS[card.rarity]} · {TRIGGER_LABELS[card.trigger] ?? card.trigger}
                      </p>
                      <p className="text-muted-foreground">
                        nível {card.levelRequired} · peso {card.dropWeight} ·{' '}
                        {card.maxSupply === 0 ? 'tiragem ilimitada' : `tiragem ${card.mintedCount}/${card.maxSupply}`}
                      </p>
                      <p className="text-muted-foreground">
                        {card.ownedBy} no álbum de participantes · {card.isActive ? 'ativa' : 'inativa'}
                        {card.isSecret ? ' · secreta' : ''}
                      </p>
                      {arquivando && card.archivedAt ? (
                        <p className="text-muted-foreground" data-testid={`card-archived-${card.id}`}>
                          Arquivada em {formatZonedDateTime(card.archivedAt, timezone)} por{' '}
                          {card.archivedByName ?? 'conta removida'}
                        </p>
                      ) : null}
                      <p className="text-muted-foreground" data-testid={`card-usage-${card.id}`}>
                        {card.usedByMissions} missão(ões) como prêmio · {card.usedByQrCodes} QR de patrocinador
                      </p>
                      <p className="code-data text-muted-foreground">{card.slug}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                    {arquivando ? (
                      <InlineActionForm
                        action={restoreCardTemplateAction}
                        submitLabel="Restaurar"
                        testId={`card-restore-${card.id}`}
                        confirm={{
                          title: `Restaurar a carta “${card.name}”?`,
                          description: `Ela volta ao catálogo ativo e volta a ser concedida.${
                            card.archivedAt
                              ? ` Arquivada em ${formatZonedDateTime(card.archivedAt, timezone)}${
                                  card.archivedByName ? ` por ${card.archivedByName}` : ''
                                }.`
                              : ''
                          }`,
                          confirmLabel: 'Restaurar carta',
                          tone: 'default',
                        }}
                      >
                        <input type="hidden" name="tenantSlug" value={tenantSlug} />
                        <input type="hidden" name="cardTemplateId" value={card.id} />
                      </InlineActionForm>
                    ) : (
                      <>
                        <Link
                          href={tenantPath(tenantSlug, `/administracao/cartas/${card.id}/editar`)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground hover:text-primary"
                          data-testid={`card-edit-${card.id}`}
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          Editar carta
                        </Link>

                        <InlineActionForm
                          action={deleteCardTemplateAction}
                          submitLabel="Excluir"
                          variant="destructive"
                          testId={`card-delete-${card.id}`}
                          confirm={{
                            title: `Excluir a carta “${card.name}”?`,
                            description:
                              card.usedByMissions > 0 || card.usedByQrCodes > 0
                                ? `Ela é prêmio de ${card.usedByMissions} missão(ões) e de ${card.usedByQrCodes} QR de patrocinador — a exclusão vai ser recusada até trocar o prêmio.`
                                : `A carta sai do catálogo e deixa de ser concedida. ${card.ownedBy > 0 ? `As ${card.ownedBy} pessoa(s) que já a ganharam continuam com ela no álbum.` : 'Ninguém a ganhou ainda.'} Ela pode ser restaurada em "Mostrar arquivados".`,
                            confirmLabel: 'Excluir carta',
                          }}
                        >
                          <input type="hidden" name="tenantSlug" value={tenantSlug} />
                          <input type="hidden" name="cardTemplateId" value={card.id} />
                        </InlineActionForm>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/*
        Conceder só existe no catálogo ATIVO: uma carta arquivada não é
        concedida (o motor de recompensas filtra `deletedAt: null`).
      */}
      {(participants.length > 0 || Boolean(buscaParticipante)) && !arquivando ? (
        <section
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
          aria-labelledby="conceder"
          data-testid="grant-card-section"
        >
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-3">
            <div>
              <h2 id="conceder" className="text-base font-semibold tracking-tight text-foreground">
                Conceder carta manualmente
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                A concessão respeita nível exigido, janela de disponibilidade e tiragem — um passe livre administrativo
                criaria cartas além do limite e destruiria a escassez da coleção.
              </p>
            </div>

            <form
              method="get"
              action={tenantPath(tenantSlug, '/administracao/cartas')}
              className="flex items-center gap-2"
              data-testid="grant-participant-search"
            >
              <label htmlFor="busca-participante-carta" className="sr-only">
                Filtrar participante por nome ou e-mail
              </label>
              <input
                id="busca-participante-carta"
                type="search"
                name="participante"
                defaultValue={buscaParticipante}
                placeholder="Filtrar participante…"
                className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                type="submit"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground hover:bg-muted"
              >
                <Search className="size-3.5" aria-hidden />
                Buscar
              </button>
            </form>
          </div>

          {totalParticipants > participants.length ? (
            <p
              className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-strong"
              data-testid="grant-participants-truncated"
            >
              Mostrando {participants.length} de {totalParticipants} participantes ativos. Use a busca acima para
              localizar outra pessoa pelo nome ou e-mail.
            </p>
          ) : null}

          {participants.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="grant-participants-empty">
              Nenhum participante ativo encontrado para “{buscaParticipante}”.
            </p>
          ) : (
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
          )}
        </section>
      ) : null}
    </main>
  );
}
