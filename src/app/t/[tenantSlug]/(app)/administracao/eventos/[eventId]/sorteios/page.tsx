import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, History, KeyRound, ShieldCheck, Trophy } from 'lucide-react';

import { requirePagePermission } from '@/lib/auth/guard-page';
import { PERMISSIONS } from '@/domain/rbac/permissions';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPE_LABELS } from '@/domain/raffles/raffle-rules';
import {
  describeRaffleHistoryFilter,
  parseRaffleHistoryFilter,
  raffleFilterIsActive,
} from '@/domain/raffles/stage-rules';
import { getAdminEvent } from '@/lib/admin/catalog-service';
import { listRaffles } from '@/lib/raffles/raffle-service';
import { seedVaultStatus } from '@/lib/raffles/seed-vault';
import { withTenant } from '@/lib/db/tenant-client';
import { RaffleConsole } from '@/components/raffles/raffle-console';
import { RaffleHistory } from '@/components/raffles/raffle-history';
import {
  cancelRaffleAction,
  createAndDrawRaffleAction,
  drawRaffleAction,
  markPrizeDeliveredAction,
  previewRaffleAction,
  reversePrizeDeliveryAction,
  setRaffleVisibilityAction,
} from '@/app/actions/raffle-actions';

export const metadata = { title: 'Sorteios' };
export const dynamic = 'force-dynamic';

/**
 * Sorteios do evento.
 *
 * A tela reúne o que o organizador precisa no palco: **conferir** quem concorre (com
 * a contagem se atualizando ao vivo enquanto o credenciamento acontece), **sortear**
 * com revelação, **entregar** o prêmio pelo balcão — inclusive DESFAZENDO um registro
 * errado — e **provar** depois como foi apurado (hash, compromisso da semente e
 * trilha). A partir da FASE 22 o histórico é filtrável e a situação do cofre de
 * sementes aparece aqui, porque é nesta tela que alguém descobre que o cofre não está
 * configurado.
 */
export default async function RafflesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantSlug: string; eventId: string }>;
  searchParams: Promise<{
    pagina?: string;
    situacao?: string;
    de?: string;
    ate?: string;
  }>;
}) {
  const { tenantSlug, eventId } = await params;
  const { pagina, situacao, de, ate } = await searchParams;

  const { tenantId } = await requirePagePermission({
    tenantSlug,
    permission: PERMISSIONS.EVENT_MANAGE,
    fallbackPath: '/administracao/eventos',
  });

  const event = await getAdminEvent(tenantId, eventId);
  if (!event) notFound();

  /**
   * O fuso vem do EVENTO, não do processo (armadilha 38): o filtro por data é o dia
   * em que a instituição viveu o sorteio, e o servidor roda em UTC.
   */
  const filterResult = parseRaffleHistoryFilter({
    status: situacao,
    from: de,
    to: ate,
    timeZone: event.timezone,
  });

  const [rafflesResult, activities] = await Promise.all([
    listRaffles(tenantId, eventId, {
      page: Number(pagina ?? 1) || 1,
      filter: filterResult.ok ? filterResult.filter : undefined,
    }),
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
  const vault = seedVaultStatus();

  const filter = filterResult.ok ? filterResult.filter : null;
  const filterActive = filter !== null && raffleFilterIsActive(filter);

  /** O filtro serializado, para a paginação e para os links não o perderem. */
  const filterQuery = [
    situacao && situacao !== 'ALL' ? `situacao=${encodeURIComponent(situacao)}` : '',
    de ? `de=${encodeURIComponent(de)}` : '',
    ate ? `ate=${encodeURIComponent(ate)}` : '',
  ]
    .filter(Boolean)
    .map((part) => `&${part}`)
    .join('');

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

      {/**
       * O filtro do histórico recusado (data invertida, situação inválida) precisa ser
       * DITO: sem isto, a tela mostraria a lista inteira e a pessoa acharia que o
       * filtro não funcionou.
       */}
      {filterResult.ok ? null : (
        <p
          className="rounded-lg border border-destructive/40 bg-destructive-soft p-3 text-sm text-destructive"
          data-testid="raffle-filter-error"
          role="alert"
        >
          {filterResult.message}
        </p>
      )}

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
          reverseAction={reversePrizeDeliveryAction}
          visibilityAction={setRaffleVisibilityAction}
          filter={{
            status: situacao ?? 'ALL',
            from: de ?? '',
            to: ate ?? '',
            active: filterActive,
            description: filter ? describeRaffleHistoryFilter(filter) : '',
          }}
          filterQuery={filterQuery}
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
        {vault.configured ? null : (
          <span className="block pt-1 text-warning-strong">
            O cofre de sementes não está configurado neste ambiente: o resultado continua auditável por
            hash, mas não é reproduzível por terceiros.
          </span>
        )}
      </p>

      {/**
       * ── SITUAÇÃO DO COFRE (FASE 22, item G12) ───────────────────────────────────
       * A chave tem VERSÃO, e a tela diz qual está em uso e quais continuam
       * disponíveis — é aqui que alguém descobre, ANTES do palco, que a chave com que
       * um sorteio antigo foi selado já não está no ambiente. Sem esta linha, a
       * descoberta aconteceria na apuração, com o público esperando.
       */}
      <p
        className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground"
        data-testid="raffle-vault-status"
        data-vault-configured={vault.configured ? 'true' : 'false'}
        data-vault-version={vault.currentVersion === null ? '' : String(vault.currentVersion)}
      >
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Chave do cofre em uso: <strong>{vault.currentVersionLabel}</strong>
          {vault.versions.length > 0
            ? ` · versões disponíveis para abrir sementes antigas: ${vault.versions.join(', ')}`
            : ''}
          . Sorteios novos selam com a versão atual; abrir um selo antigo usa a versão GRAVADA nele, então
          girar a chave não invalida compromisso publicado.
          {vault.problems.length > 0 ? (
            <span className="block pt-1 text-warning-strong" data-testid="raffle-vault-problems">
              {vault.problems.join(' ')}
            </span>
          ) : null}
        </span>
      </p>
    </main>
  );
}
