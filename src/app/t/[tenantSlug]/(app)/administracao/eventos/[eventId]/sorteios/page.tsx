import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, ShieldCheck, Trophy } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPE_LABELS } from '@/domain/raffles/raffle-rules';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listRaffles } from '@/lib/raffles/raffle-service';
import { isSeedVaultConfigured } from '@/lib/raffles/seed-vault';
import { withTenant } from '@/lib/db/tenant-client';
import { RaffleConsole } from '@/components/raffles/raffle-console';
import { RaffleHistory } from '@/components/raffles/raffle-history';
import {
  cancelRaffleAction,
  createAndDrawRaffleAction,
  drawRaffleAction,
  markPrizeDeliveredAction,
  previewRaffleAction,
  setRaffleVisibilityAction,
} from '@/app/actions/raffle-actions';

export const metadata = { title: 'Sorteios' };
export const dynamic = 'force-dynamic';

/**
 * Sorteios do evento.
 *
 * A tela reúne o que o organizador precisa no palco: **conferir** quem concorre (com
 * a contagem se atualizando sozinha enquanto o credenciamento acontece), **sortear**
 * com revelação e **provar** depois como foi apurado (hash, compromisso da semente e
 * trilha).
 */
export default async function RafflesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { tenantSlug, eventId } = await params;
  const { pagina } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
    fallbackPath: '/administracao/eventos',
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const [rafflesResult, activities] = await Promise.all([
    listRaffles(tenantId, eventId, { page: Number(pagina ?? 1) || 1 }),
    withTenant(tenantId, (tx) =>
      tx.activity.findMany({
        where: { tenantId, eventId, deletedAt: null },
        orderBy: { startsAt: 'asc' },
        take: 200,
        select: { id: true, title: true, startsAt: true },
      }),
    ),
  ]);

  const raffles = rafflesResult.ok ? rafflesResult.raffles : [];
  const vaultConfigured = isSeedVaultConfigured();

  return (
    <main className="max-w-5xl space-y-8">
      <header className="space-y-1.5">
        <nav className="text-xs">
          <Link
            href={tenantPath(tenantSlug, `/administracao/eventos/${eventId}`)}
            className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          >
            <ArrowLeft className="size-3" aria-hidden />
            Gerenciar {event.title}
          </Link>
        </nav>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Trophy className="size-6 text-warning" aria-hidden />
          Sorteios
        </h1>
        <p className="text-sm text-muted-foreground">
          Elegibilidade por <strong>presença real</strong>: só concorre quem compareceu, conforme o
          credenciamento registrado. A apuração usa gerador criptográfico e fica auditada por hash.
        </p>
      </header>

      {activities.length === 0 ? (
        <p className="rounded-lg border border-warning/40 bg-warning-soft p-4 text-sm text-warning-strong">
          Este evento ainda não tem atividades cadastradas. O sorteio por atividade exige ao menos uma —
          e o sorteio por dia depende das datas das atividades.
        </p>
      ) : null}

      <RaffleConsole
        tenantSlug={tenantSlug}
        eventId={eventId}
        activities={activities.map((activity) => ({
          id: activity.id,
          title: activity.title,
          startsAt: activity.startsAt.toISOString(),
        }))}
        previewAction={previewRaffleAction}
        drawAction={createAndDrawRaffleAction}
      />

      <section className="space-y-4" aria-labelledby="historico">
        <h2 id="historico" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <History className="size-4" aria-hidden />
          Histórico de apurações
        </h2>

        <RaffleHistory
          tenantSlug={tenantSlug}
          eventId={eventId}
          page={rafflesResult.ok ? rafflesResult.page : 1}
          totalPages={rafflesResult.ok ? rafflesResult.totalPages : 1}
          total={rafflesResult.ok ? rafflesResult.total : raffles.length}
          drawAction={drawRaffleAction}
          cancelAction={cancelRaffleAction}
          deliverAction={markPrizeDeliveredAction}
          visibilityAction={setRaffleVisibilityAction}
          raffles={raffles.map((raffle) => ({
            id: raffle.id,
            title: raffle.title,
            scopeLabel: RAFFLE_SCOPE_LABELS[raffle.scope],
            activityTitle: raffle.activityTitle,
            referenceDay: raffle.referenceDay,
            status: raffle.status,
            winnersCount: raffle.winnersCount,
            alternatesCount: raffle.alternatesCount,
            weightByMinutes: raffle.weightByMinutes,
            isPublic: raffle.isPublic,
            eligibleCount: raffle.eligibleCount,
            inspectedAttendances: raffle.inspectedAttendances,
            minAttendanceMinutes: raffle.minAttendanceMinutes,
            allowPriorEventWinners: raffle.allowPriorEventWinners,
            drawnAtLabel: raffle.drawnAt
              ? raffle.drawnAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
              : null,
            resultHash: raffle.resultHash,
            seedCommitment: raffle.seedCommitment,
            seedRevealed: raffle.seedRevealed,
            createdByName: raffle.createdByName,
            winners: raffle.winners.map((winner) => ({
              id: winner.id,
              position: winner.position,
              userId: winner.userId,
              userName: winner.userName,
              minutes: winner.minutes,
              kind: winner.kind,
              deliveredAtLabel: winner.deliveredAt
                ? winner.deliveredAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                : null,
              deliveredByName: winner.deliveredByName,
              deliveryNote: winner.deliveryNote,
            })),
          }))}
        />
      </section>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Cada apuração grava o hash SHA-256 do resultado (regras aplicadas + titulares e suplentes na
        ordem sorteada) e entra na trilha de auditoria do painel. O compromisso da semente é publicado
        na <strong>criação</strong> do sorteio e a semente só é revelada na apuração: quem conferir
        recalcula o hash da semente, compara com o compromisso e reproduz o resultado com ela.
        {vaultConfigured ? null : (
          <span className="block pt-1 text-warning-strong">
            O cofre de sementes não está configurado neste ambiente (BETTER_AUTH_SECRET ausente): o
            resultado continua auditável por hash, mas não é reproduzível por terceiros.
          </span>
        )}
      </p>
    </main>
  );
}
