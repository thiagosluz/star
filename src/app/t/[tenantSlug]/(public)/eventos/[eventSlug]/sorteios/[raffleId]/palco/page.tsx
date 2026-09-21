import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getPublicEvent, getTenantContext } from '@/lib/events/event-repository';
import { getRaffleStageView } from '@/lib/raffles/raffle-service';
import { tenantPath } from '@/domain/tenancy/resolution';
import { ThemeScope } from '@/components/events/theme-scope';
import { RaffleStage, type StageModel, type StageRoundModel } from '@/components/raffles/raffle-stage';

export const dynamic = 'force-dynamic';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  PALCO PÚBLICO DO SORTEIO (FASE 29)
 *  `/t/<slug>/eventos/<eventSlug>/sorteios/<raffleId>/palco`
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE ESTA PÁGINA EXISTE, SE JÁ HÁ A DO RESULTADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A página do resultado (FASE 22) responde "quem ganhou" — ela exige sorteio
 *  apurado E publicado, e é feita para consultar e compartilhar depois. O telão
 *  responde outra pergunta, e responde ANTES: "quem está concorrendo, e qual foi o
 *  compromisso?". Durante o credenciamento, a parede mostra a contagem subindo; na
 *  hora da apuração, ela mesma percebe e revela.
 *
 *  As três decisões que sustentam esta tela:
 *
 *    1. **O endereço é fixo desde a criação.** O organizador testa o telão antes do
 *       evento e cola o mesmo link no dia — não existe "publicar no palco" para
 *       alguém esquecer de ligar no meio da abertura;
 *    2. **O compromisso aparece ANTES da apuração.** É o que dá sentido ao
 *       commit-reveal: compromisso que só se torna visível depois não prova que a
 *       semente foi escolhida antes. Esta é a única tela que mostra isso;
 *    3. **O título do prêmio é público.** É o que o telão anuncia — e é o que ele
 *       existe para fazer. O endereço é um UUID não enumerável, e a página pede
 *       `noindex`: ela é para projetar, não para aparecer em busca.
 *
 *  A PRIVACIDADE dos nomes é a mesma de todo o resto: o servidor entrega o nome já
 *  mascarado (`publicWinnerName`), e o telão não decide consentimento — quem
 *  autorizou o perfil público aparece inteiro, quem não autorizou aparece abreviado,
 *  inclusive na parede.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}): Promise<Metadata> {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) return { title: 'Sorteio' };

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) return { title: 'Sorteio' };

  const stage = await getRaffleStageView({
    tenantId: tenant.tenantId,
    eventId: event.id,
    raffleId,
  });

  if (!stage) return { title: 'Sorteio' };

  return {
    title: `${stage.title} — palco do sorteio`,
    description: `Acompanhe ao vivo o sorteio de ${event.title}.`,
    robots: { index: false, follow: false },
  };
}

export default async function RaffleStagePage({
  params,
}: {
  params: Promise<{ tenantSlug: string; eventSlug: string; raffleId: string }>;
}) {
  const { tenantSlug, eventSlug, raffleId } = await params;

  const tenant = await getTenantContext(tenantSlug);
  if (!tenant) notFound();

  const event = await getPublicEvent(tenant.tenantId, eventSlug);
  if (!event) notFound();

  const stage = await getRaffleStageView({
    tenantId: tenant.tenantId,
    eventId: event.id,
    raffleId,
  });

  if (!stage) notFound();

  const basePath = `/eventos/${event.slug}/sorteios/${raffleId}`;

  /**
   * ── A RODADA VIRA O MODELO DA PAREDE (FASE 30) ────────────────────────────────
   * O telão não mostra "o sorteio": ele mostra UMA RODADA — a que está anunciada ou a
   * que acabou de ser apurada —, com o prêmio e o patrocinador daquele momento. Os
   * nomes da roleta vêm da lista publicada da rodada, já mascarados pelo servidor.
   */
  const toRound = (round: NonNullable<typeof stage.currentRound>): StageRoundModel => ({
    roundNumber: round.roundNumber,
    prizeTitle: round.prizeTitle,
    prizeDescription: round.prizeDescription,
    sponsorName: round.sponsorName,
    drawnAtIso: round.drawnAt?.toISOString() ?? null,
    seedCommitment: round.seedCommitment,
    seedRevealed: round.seedRevealed,
    resultHash: round.resultHash,
    winnersCount: round.winnersCount,
    alternatesCount: round.alternates.length,
    rollNames: round.rollNames,
    winners: round.winners,
    alternates: round.alternates,
  });

  const model: StageModel = {
    raffleId: stage.raffleId,
    title: stage.title,
    description: stage.description,
    state: stage.state,
    currentRound: stage.currentRound ? toRound(stage.currentRound) : null,
    previousRounds: stage.previousRounds.map(toRound),
    minAttendanceMinutes: stage.minAttendanceMinutes,
    eligibleCount: stage.eligibleCount,
    auditHref: tenantPath(tenantSlug, `${basePath}/auditoria`),
  };

  return (
    <ThemeScope theme={event.theme}>
      <RaffleStage
        model={model}
        liveUrl={`/api/t/${tenantSlug}${basePath}/ao-vivo`}
      />
    </ThemeScope>
  );
}
