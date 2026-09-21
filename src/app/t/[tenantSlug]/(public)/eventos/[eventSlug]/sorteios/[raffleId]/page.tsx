import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Trophy } from 'lucide-react';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { tenantPath } from '@/domain/tenancy/resolution';
import { getPublicRaffleResult } from '@/lib/raffles/raffle-service';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RESULTADO PÚBLICO DE UM SORTEIO (FASE 22, item G11)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE UMA PÁGINA, SE A SEÇÃO DO EVENTO JÁ MOSTRA O RESULTADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A seção resolve a DIVULGAÇÃO: quem abre a página do evento vê todos os resultados
 *  publicados. O que ela não resolve é o uso de palco — projetar o resultado de UM
 *  sorteio, com os nomes grandes e a prova da semente à mão, e ter um endereço para
 *  compartilhar depois ("o resultado está em…"). A seção não tem endereço próprio, e
 *  um `#ancora` num bloco de 20 resultados não é o que se cola no grupo do evento.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  AS TRÊS CONDIÇÕES PARA ESTA PÁGINA EXISTIR
 *  ─────────────────────────────────────────────────────────────────────────────
 *    1. o evento é publicamente visível (a mesma leitura da landing page: rascunho
 *       não tem página pública);
 *    2. o sorteio foi MARCADO como publicado pela instituição (`isPublic`) — publicar
 *       nome de ganhador é ato dela, não efeito colateral de apurar;
 *    3. o sorteio foi APURADO.
 *
 *  Faltando qualquer uma, a resposta é 404 — e não uma página explicando "existe, mas
 *  não está publicado": isso já seria informação que quem não organiza não deveria
 *  receber (mesma decisão do material de palestrante de inscritos, FASE 25).
 *
 *  O nome sai MASCARADO por padrão (`publicWinnerName`), e a página publica a PROVA
 *  junto do resultado: hash do resultado, compromisso e semente revelada. Publicar só
 *  o nome transformaria o sorteio em promessa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Resultado do sorteio' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Resultado do sorteio' };

  const result = await getPublicRaffleResult(tenant.tenantId, event.id, raffleId);
  if (!result) return { title: 'Resultado do sorteio' };

  return {
    title: `${result.title} — resultado do sorteio`,
    description: `Resultado do sorteio publicado em ${event.title}, com a prova da semente.`,
    alternates: {
      canonical: tenantPath(tenantSlug, `/eventos/${event.slug}/sorteios/${raffleId}`),
    },
  };
}

export default async function PublicRaffleResultPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}) {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  const result = await getPublicRaffleResult(tenant.tenantId, event.id, raffleId);
  if (!result) notFound();

  const drawnAtLabel = result.drawnAt.toLocaleString('pt-BR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const basePath = `/eventos/${event.slug}/sorteios/${raffleId}`;

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
      <nav className="flex flex-wrap items-center gap-4 text-xs">
        <Link
          href={tenantPath(tenantSlug, `/eventos/${event.slug}`)}
          className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
          data-testid="raffle-result-back"
        >
          <ArrowLeft className="size-3" aria-hidden />
          {event.title}
        </Link>
        <Link
          href={tenantPath(tenantSlug, `${basePath}/auditoria`)}
          className="text-muted-foreground underline underline-offset-4"
          data-testid="raffle-result-audit-link"
        >
          Conferir a auditoria (semente e lista, rodada a rodada)
        </Link>
      </nav>

      <header className="space-y-2">
        <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Trophy className="size-4 text-warning" aria-hidden />
          Resultado do sorteio
        </p>
        <h1 className="text-3xl font-semibold tracking-tight" data-testid="raffle-result-title">
          {result.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Apurado em {drawnAtLabel} · {result.winners.length} titular(es)
          {result.alternates.length > 0 ? ` · ${result.alternates.length} suplente(s)` : ''}
          {result.rounds.length > 1 ? ` · ${result.rounds.length} rodadas` : ''}
        </p>
        {result.description ? <p className="text-sm">{result.description}</p> : null}
      </header>

      {/**
       * ── UMA SEÇÃO POR RODADA (FASE 30) ─────────────────────────────────────────
       * O sorteio pode ter vários MOMENTOS, cada um com o seu prêmio e o seu
       * patrocinador. Mostrar uma lista única de nomes esconderia qual prêmio cada
       * pessoa levou — e as posições continuam a numeração entre as rodadas, então a
       * ordem sozinha não conta a história.
       */}
      {result.rounds.map((round, index) => (
        <section
          key={round.roundNumber}
          className="space-y-3"
          aria-labelledby={`ganhadores-${round.roundNumber}`}
          data-testid={`raffle-result-round-${round.roundNumber}`}
        >
          <div className="space-y-1">
            <h2 id={`ganhadores-${round.roundNumber}`} className="text-lg font-semibold tracking-tight">
              {result.rounds.length > 1 ? `Rodada ${round.roundNumber} — ` : 'Quem ganhou'}
              {round.prizeTitle ?? (result.rounds.length > 1 ? 'prêmio surpresa' : 'Quem ganhou')}
            </h2>
            {round.prizeDescription ? (
              <p className="text-sm text-muted-foreground">{round.prizeDescription}</p>
            ) : null}
            <p className="text-xs text-muted-foreground" data-testid={`raffle-result-round-sponsor-${round.roundNumber}`}>
              {round.sponsorName ? `Prêmio oferecido por ${round.sponsorName}` : 'Sem patrocinador informado'}
              {' · '}
              {round.drawnAt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </p>
          </div>

          <ol
            className="grid gap-2 sm:grid-cols-2"
            data-testid={
              result.rounds.length === 1
                ? 'raffle-result-winners'
                : `raffle-result-round-winners-${round.roundNumber}`
            }
          >
            {round.winners.map((winner) => (
              <li
                key={winner.position}
                data-testid={`raffle-result-winner-${winner.position}`}
                data-masked={winner.masked ? 'true' : 'false'}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
              >
                <span className="code-data flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
                  {winner.position}º
                </span>
                <span className="truncate text-sm font-medium">{winner.name}</span>
              </li>
            ))}
          </ol>

          {round.alternates.length > 0 ? (
            <details className="text-xs text-muted-foreground">
              <summary
                className="cursor-pointer"
                data-testid={
                  result.rounds.length === 1
                    ? 'raffle-result-alternates'
                    : `raffle-result-round-alternates-${round.roundNumber}`
                }
              >
                {round.alternates.length} suplente(s) — entregam em caso de ausência
              </summary>
              <ol className="mt-2 space-y-1">
                {round.alternates.map((alternate) => (
                  <li key={alternate.position}>
                    {alternate.position}º {alternate.name}
                  </li>
                ))}
              </ol>
            </details>
          ) : null}

          <details className="text-xs text-muted-foreground" open={index === result.rounds.length - 1}>
            <summary className="cursor-pointer">Prova desta rodada</summary>
            <div className="mt-2 space-y-1" data-testid={`raffle-result-round-proof-${round.roundNumber}`}>
              {round.resultHash ? (
                <p className="break-all code-data">resultado (SHA-256): {round.resultHash}</p>
              ) : null}
              {round.seedCommitment ? (
                <p className="break-all code-data">compromisso publicado antes: {round.seedCommitment}</p>
              ) : null}
              {round.seedRevealed ? (
                <p className="break-all code-data">semente revelada: {round.seedRevealed}</p>
              ) : null}
            </div>
          </details>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Nomes abreviados por padrão: quem se credenciou não consentiu em ter o nome publicado. Quem
        tem perfil público aparece com o nome completo.
      </p>

      {/**
       * ── A PROVA, NA MESMA PÁGINA ────────────────────────────────────────────────
       * O compromisso foi publicado ANTES de cada rodada (antes de existir resultado) e
       * a semente só foi revelada na apuração daquela rodada. Quem quiser conferir
       * recalcula `sha256(semente)` e compara com o compromisso; com a semente,
       * reproduz o resultado. É o que separa "confie" de "confira".
       */}
      <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-labelledby="prova">
        <h2 id="prova" className="text-sm font-semibold">
          Como conferir
        </h2>

        <div className="space-y-1 text-xs text-muted-foreground" data-testid="raffle-result-proof">
          {result.resultHash ? (
            <p className="break-all code-data">
              resultado da última rodada (SHA-256): {result.resultHash}
            </p>
          ) : null}
          {result.seedCommitment ? (
            <p className="break-all code-data">compromisso publicado: {result.seedCommitment}</p>
          ) : null}
          {result.seedRevealed ? (
            <p className="break-all code-data">semente revelada: {result.seedRevealed}</p>
          ) : null}
          {result.seedCommitment && result.seedRevealed ? (
            <p>
              O <code>sha256</code> da semente revelada é igual ao compromisso publicado antes da
              apuração, e o resultado se reproduz rodando o sorteio com ela. A auditoria mostra a
              conferência de CADA rodada, com a lista publicada daquele momento.
            </p>
          ) : (
            <p className="text-warning-strong">
              Este sorteio não tem compromisso de semente: o resultado é auditável por hash, mas não
              é reproduzível por terceiros.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
