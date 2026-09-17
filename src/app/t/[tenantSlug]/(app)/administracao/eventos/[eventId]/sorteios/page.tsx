import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, ShieldCheck, Trophy } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPE_LABELS } from '@/domain/raffles/raffle-rules';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listRaffles } from '@/lib/raffles/raffle-service';
import { withTenant } from '@/lib/db/tenant-client';
import { RaffleConsole } from '@/components/raffles/raffle-console';
import { RaffleHistory } from '@/components/raffles/raffle-history';
import {
  cancelRaffleAction,
  createAndDrawRaffleAction,
  drawRaffleAction,
  previewRaffleAction,
} from '@/app/actions/raffle-actions';

export const metadata = { title: 'Sorteios' };
export const dynamic = 'force-dynamic';

/**
 * Sorteios do evento.
 *
 * A tela reúne o que o organizador precisa no palco: **conferir** quem concorre,
 * **sortear** com revelação e **provar** depois como foi apurado (hash + trilha).
 */
export default async function RafflesPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
}) {
  const { tenantSlug, eventId } = await params;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
    fallbackPath: '/administracao/eventos',
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  const [rafflesResult, activities] = await Promise.all([
    listRaffles(tenantId, eventId),
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

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-6 py-10">
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
          <Trophy className="size-6 text-amber-500" aria-hidden />
          Sorteios
        </h1>
        <p className="text-sm text-muted-foreground">
          Elegibilidade por <strong>presença real</strong>: só concorre quem compareceu, conforme o
          credenciamento registrado. A apuração usa gerador criptográfico e fica auditada por hash.
        </p>
      </header>

      {activities.length === 0 ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-700">
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
          drawAction={drawRaffleAction}
          cancelAction={cancelRaffleAction}
          raffles={raffles.map((raffle) => ({
            id: raffle.id,
            title: raffle.title,
            scopeLabel: RAFFLE_SCOPE_LABELS[raffle.scope],
            activityTitle: raffle.activityTitle,
            referenceDay: raffle.referenceDay,
            status: raffle.status,
            winnersCount: raffle.winnersCount,
            eligibleCount: raffle.eligibleCount,
            inspectedAttendances: raffle.inspectedAttendances,
            minAttendanceMinutes: raffle.minAttendanceMinutes,
            allowPriorEventWinners: raffle.allowPriorEventWinners,
            drawnAtLabel: raffle.drawnAt
              ? raffle.drawnAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
              : null,
            resultHash: raffle.resultHash,
            createdByName: raffle.createdByName,
            winners: raffle.winners,
          }))}
        />
      </section>

      <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        Cada apuração grava o hash SHA-256 do resultado (regras aplicadas + vencedores na ordem
        sorteada) e entra na trilha de auditoria do painel. Alterar qualquer vencedor, a ordem ou o
        piso de minutos muda o hash — é assim que se confere depois que o registro não foi mexido.
      </p>
    </main>
  );
}
