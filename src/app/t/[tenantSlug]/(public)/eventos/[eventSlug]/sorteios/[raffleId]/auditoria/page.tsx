import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText, ShieldCheck, Trophy } from 'lucide-react';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { auditPoolDocument, getRaffleAudit, type RaffleAuditRound } from '@/lib/raffles/raffle-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { RAFFLE_SCOPE_LABELS } from '@/domain/raffles/raffle-rules';
import { RaffleAuditPanel, type RaffleAuditModel } from '@/components/raffles/raffle-audit';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  AUDITORIA PÚBLICA DE UM SORTEIO (FASE 29 · POR RODADA desde a FASE 30)
 *  `/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/auditoria`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O DEFEITO QUE ESTA PÁGINA FECHOU (FASE 29)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página do resultado publicava três hashes e escrevia: "o resultado se reproduz
 *  rodando o sorteio com ela". Só que a ENTRADA do sorteio — quem eram os elegíveis,
 *  em que ordem, com quantos minutos — nunca era publicada. O texto prometia uma
 *  conferência que ninguém conseguia fazer; a auditoria era meia: conferia-se o selo,
 *  não a conta.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E POR QUE ELA PASSOU A TER UMA SEÇÃO POR RODADA (FASE 30)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Cada apuração é um MOMENTO, com a própria semente, a própria lista e o próprio
 *  documento assinado. Um veredito único no fim do sorteio não diria QUAL momento
 *  foi conferido — e o resultado da rodada 2 no lugar da 1 passaria como íntegro.
 *  Aqui cada rodada se confere sozinha, com o seu prêmio e o seu patrocinador.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  E O QUE ESTA PÁGINA **NÃO** PROVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O compromisso amarra a SEMENTE. A lista não pode ser comprometida antes porque o
 *  credenciamento continua até o momento da apuração — quem tinha acesso ao banco
 *  poderia, em tese, montar a lista e escolher uma semente até gostar do resultado,
 *  desde que o compromisso fosse publicado depois. O que a conferência garante é:
 *  a semente de cada rodada foi fixada ANTES dela (a trilha tem data), a lista
 *  publicada é a que gerou o resultado gravado, e nada disso mudou depois. Dizer isso
 *  em voz alta, na própria página, é o que separa auditoria de teatro.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Auditoria do sorteio' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Auditoria do sorteio' };

  const audit = await getRaffleAudit({ tenantId: tenant.tenantId, eventId: event.id, raffleId });
  if (!audit) return { title: 'Auditoria do sorteio' };

  return {
    title: `${audit.title} — auditoria do sorteio`,
    description: 'Confira a semente, a lista publicada e a reprodução do resultado, rodada a rodada.',
    robots: { index: false, follow: false },
  };
}

const dateTime = (value: Date | null): string =>
  value ? value.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' }) : '—';

/** Uma rodada da auditoria: cabeçalho, cadeia de prova, conferência e listas. */
function RoundSection({ round }: { round: RaffleAuditRound }) {
  const poolDocument = auditPoolDocument(round.pool);

  const model: RaffleAuditModel = {
    roundNumber: round.roundNumber,
    seedCommitment: round.seedCommitment,
    seedRevealed: round.seedRevealed,
    poolHash: round.poolHash,
    poolDocument: poolDocument || null,
    pool: round.pool,
    winnersCount: round.winnersCount,
    alternatesCount: round.alternatesCount,
    weightByMinutes: round.weightByMinutes,
    storedWinners: round.winners.map((winner) => ({ position: winner.position, code: winner.code })),
    serverReproduction: round.reproduction.possible
      ? {
          possible: true,
          reason: null,
          confirmed: round.reproduction.confirmed,
          matched: round.reproduction.matched,
          diverged: round.reproduction.diverged,
          positions: round.reproduction.positions,
        }
      : {
          possible: false,
          reason: round.reproduction.reason,
          confirmed: false,
          matched: 0,
          diverged: 0,
          positions: [],
        },
  };

  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-surface-low p-4"
      data-testid={`audit-round-${round.roundNumber}`}
      data-round-drawn={round.drawnAt ? 'true' : 'false'}
    >
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Trophy className="size-3.5 text-warning" aria-hidden />
          Rodada {round.roundNumber}
        </p>
        <h2 className="text-lg font-semibold tracking-tight" data-testid={`audit-round-title-${round.roundNumber}`}>
          {round.prizeTitle ?? 'Prêmio surpresa'}
        </h2>
        {round.prizeDescription ? (
          <p className="text-sm text-muted-foreground">{round.prizeDescription}</p>
        ) : null}
        <p className="text-xs text-muted-foreground" data-testid={`audit-round-sponsor-${round.roundNumber}`}>
          {round.sponsorName
            ? `Patrocinador do prêmio: ${round.sponsorName}`
            : 'Sem patrocinador informado'}
          {' · '}
          {round.drawnAt ? `apurada em ${dateTime(round.drawnAt)}` : 'ainda não apurada'}
          {' · '}
          {round.winnersCount} titular(es)
          {round.alternatesCount > 0 ? ` · ${round.alternatesCount} suplente(s)` : ''}
        </p>
      </header>

      {/**
       * ── A CADEIA DE PROVA DESTA RODADA ─────────────────────────────────────────
       * Tudo o que se precisa para conferir FORA do site está impresso aqui: os três
       * números e o documento canônico da lista daquele momento.
       */}
      <dl className="space-y-2 text-xs" data-testid={`audit-chain-${round.roundNumber}`}>
        <div className="space-y-1">
          <dt className="font-medium">Compromisso publicado antes desta rodada</dt>
          <dd className="break-all code-data text-muted-foreground" data-testid={`audit-commitment-${round.roundNumber}`}>
            {round.seedCommitment ?? 'sem compromisso (cofre de sementes não configurado)'}
          </dd>
          <dd className="text-muted-foreground">
            Trilha: {dateTime(round.commitmentRecordedAt)}
            {round.commitmentRecordedBy ? ` · por ${round.commitmentRecordedBy}` : ''}
          </dd>
        </div>

        <div className="space-y-1">
          <dt className="font-medium">Semente revelada na apuração</dt>
          <dd className="break-all code-data text-muted-foreground" data-testid={`audit-seed-${round.roundNumber}`}>
            {round.seedRevealed ?? '—'}
          </dd>
        </div>

        <div className="space-y-1">
          <dt className="font-medium">
            Resultado (versão {round.resultVersion}
            {round.resultVersion === 4 ? ', com o número da rodada' : ''})
          </dt>
          <dd className="break-all code-data text-muted-foreground" data-testid={`audit-result-hash-${round.roundNumber}`}>
            {round.resultHash ?? '—'}
          </dd>
        </div>

        <div className="space-y-1">
          <dt className="font-medium">
            Lista publicada ({round.poolCount} participante(s) na ordem do sorteio)
          </dt>
          <dd className="break-all code-data text-muted-foreground" data-testid={`audit-pool-hash-${round.roundNumber}`}>
            {round.poolHash ?? 'não gravada (apuração anterior à FASE 29)'}
          </dd>
        </div>
      </dl>

      {round.duplicatedCodes.length > 0 ? (
        <p className="text-xs text-warning-strong" data-testid={`audit-duplicated-codes-${round.roundNumber}`}>
          Atenção: {round.duplicatedCodes.length} código(s) se repetem nesta lista — a conferência posição a
          posição fica ambígua.
        </p>
      ) : null}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <FileText className="size-3" aria-hidden />
            Documento canônico da lista desta rodada (é o que o hash assina)
          </span>
        </summary>
        <pre
          className="mt-2 max-h-64 overflow-auto rounded-md bg-surface-lowest p-3 code-data"
          data-testid={`audit-pool-document-${round.roundNumber}`}
        >
          {poolDocument || '—'}
        </pre>
      </details>

      {/**
       * ── A CONFERÊNCIA, NO NAVEGADOR DE QUEM LÊ ─────────────────────────────────
       * O componente refaz as três contas com WebCrypto e com a MESMA seleção do
       * servidor. Uma instância por rodada: cada momento tem a sua semente.
       */}
      <RaffleAuditPanel key={round.roundNumber} model={model} />

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Lista publicada desta rodada</h3>
          <p className="text-xs text-muted-foreground">
            Código é a identidade pública do participante NESTE sorteio. Nomes abreviados por padrão;
            quem autorizou o perfil público aparece inteiro.
          </p>
          <ol className="mt-2 max-h-64 space-y-1 overflow-auto text-xs" data-testid={`audit-pool-${round.roundNumber}`}>
            {round.poolRows.map((row) => (
              <li
                key={row.code}
                className="flex items-center justify-between gap-3 rounded border border-border px-2 py-1"
                data-testid={`audit-pool-entry-${round.roundNumber}-${row.index}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="code-data text-muted-foreground">{row.index}</span>
                  <span className="code-data" data-testid={`audit-pool-code-${round.roundNumber}-${row.index}`}>
                    {row.code}
                  </span>
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="code-data shrink-0 text-muted-foreground">{row.minutes} min</span>
              </li>
            ))}
          </ol>
          {round.poolRows.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground" data-testid={`audit-pool-empty-${round.roundNumber}`}>
              Esta rodada não tem lista publicada: ela foi apurada antes de a lista passar a ser gravada, ou
              ainda não foi apurada.
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Resultado gravado desta rodada</h3>
          <ol className="mt-2 space-y-1 text-xs" data-testid={`audit-winners-${round.roundNumber}`}>
            {round.winners.map((winner) => (
              <li key={winner.position} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="code-data text-muted-foreground">{winner.position}º</span>
                  <span className="code-data">{winner.code ?? '—'}</span>
                  <span className="truncate">{winner.name}</span>
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {winner.kind === 'ALTERNATE' ? 'suplente' : 'titular'} · {winner.minutes} min
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {round.seedRevealed ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Conferir esta rodada sem este site
          </summary>
          <pre className="mt-2 overflow-auto rounded-md bg-surface-lowest p-3 code-data">
            {`# 1. a semente revelada é a comprometida?
printf '%s' "${round.seedRevealed}" | sha256sum

# 2. a lista publicada é a assinada? (salve o documento canônico acima em lista.json)
sha256sum lista.json

# 3. a lista + a semente produzem estes ganhadores?
npx tsx prisma/scripts/audit-raffle.ts --semente "${round.seedRevealed}" --lista lista.json --vagas ${
              round.winnersCount + round.alternatesCount
            }`}
          </pre>
        </details>
      ) : null}
    </section>
  );
}

export default async function RaffleAuditPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}) {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  const audit = await getRaffleAudit({ tenantId: tenant.tenantId, eventId: event.id, raffleId });
  if (!audit) notFound();

  const basePath = `/eventos/${event.slug}/sorteios/${raffleId}`;
  const firstRound = audit.rounds[0] ?? null;

  return (
    <main className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      <nav className="flex flex-wrap items-center gap-4 text-xs">
        <Link
          href={tenantPath(tenantSlug, basePath)}
          className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          data-testid="audit-back"
        >
          <ArrowLeft className="size-3" aria-hidden />
          Resultado do sorteio
        </Link>
        <Link
          href={tenantPath(tenantSlug, `${basePath}/palco`)}
          className="text-muted-foreground underline underline-offset-4"
          data-testid="audit-stage-link"
        >
          Palco (telão)
        </Link>
      </nav>

      <header className="space-y-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" aria-hidden />
          Auditoria do sorteio
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="audit-title">
          {audit.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {RAFFLE_SCOPE_LABELS[audit.scope]} · compromisso da primeira rodada publicado em{' '}
          {dateTime(audit.commitmentRecordedAt ?? audit.createdAt)}
          {audit.commitmentRecordedBy ? ` por ${audit.commitmentRecordedBy}` : ''} ·{' '}
          {audit.rounds.length} rodada(s) ·{' '}
          {audit.status === 'DRAWN' ? `apurado em ${dateTime(audit.drawnAt)}` : 'ainda não apurado'}
        </p>
      </header>

      {/**
       * ── UMA SEÇÃO POR RODADA ───────────────────────────────────────────────────
       * Cada momento tem a sua semente e o seu documento assinado: a conferência é
       * momento a momento, e não um veredito único sobre o sorteio inteiro.
       */}
      <div className="space-y-6" data-testid="audit-rounds">
        {audit.rounds.map((round) => (
          <RoundSection key={round.roundNumber} round={round} />
        ))}
      </div>

      <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-labelledby="limite">
        <h2 id="limite" className="text-sm font-semibold">
          O que esta página prova — e o que não prova
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>
            <strong>Prova</strong> que a semente de CADA rodada foi fixada ANTES dela: o compromisso está na
            trilha de auditoria com data e autor, e a semente revelada bate com ele.
          </li>
          <li>
            <strong>Prova</strong> que a lista publicada é a entrada do resultado gravado daquela rodada: o
            hash da lista entra no conteúdo assinado, e a reprodução devolve as mesmas posições.
          </li>
          <li>
            <strong>Prova</strong> que quem ganhou uma rodada anterior não concorreu nas seguintes: o
            resultado de cada rodada lista apenas quem não havia ganhado, e o banco impede a repetição.
          </li>
          <li>
            <strong>Não prova</strong> que a lista não foi editada por quem tinha acesso ao banco antes de ser
            gravada. O credenciamento continua até a hora do sorteio, então não existe um momento anterior
            para comprometer a lista — o compromisso amarra a semente, não a lista.
          </li>
          <li>
            <strong>Não prova</strong> que o credenciamento registrou presença corretamente: isso é conferido
            na trilha de presenças do evento.
          </li>
        </ul>
        {firstRound?.seedCommitment ? null : (
          <p className="text-xs text-warning-strong">
            Este sorteio não tem compromisso de semente em nenhuma rodada: o resultado é auditável por hash,
            mas não reproduzível por terceiros.
          </p>
        )}
      </section>
    </main>
  );
}
