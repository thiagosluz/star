'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Award, Loader2 } from 'lucide-react';

import { awardTopReviewersAction } from '@/app/actions/gamification-actions';
import type { GamificationActionState } from '@/app/actions/gamification-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RECONHECIMENTO DO REVISOR DESTAQUE (FASE 16, item F1)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O GATILHO QUE NUNCA DISPARAVA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  `REVIEWER_TOP` era selecionável no catálogo de cartas e nenhum caminho do código
 *  o concedia. Diferente dos gatilhos automáticos, este é um ATO: o comitê encerra,
 *  o ranking é calculado e a instituição reconhece quem mais avaliou. Premiar a cada
 *  parecer enviado transformaria reconhecimento em acumulador de cópias.
 *
 *  O ranking aparece ANTES do botão porque o ato precisa ser informado: quem clica
 *  vê quantos pareceres cada pessoa concluiu e qual é o piso aplicado (o maior entre
 *  o padrão e o que a própria carta exige no `triggerCondition.threshold`).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ReviewerRankingRow {
  reviewerId: string;
  reviewerName: string;
  completedReviews: number;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      data-testid="award-top-reviewers"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Award className="size-4" aria-hidden />}
      {pending ? 'Concedendo…' : 'Reconhecer destaque'}
    </button>
  );
}

export function ReviewerAwardPanel({
  tenantSlug,
  eventId,
  ranking,
  minReviews,
  cardNames,
  reason,
  canAward,
}: {
  tenantSlug: string;
  eventId: string;
  ranking: readonly ReviewerRankingRow[];
  minReviews: number;
  cardNames: readonly string[];
  reason: string | null;
  canAward: boolean;
}) {
  const [state, action] = useActionState<GamificationActionState | null, FormData>(
    awardTopReviewersAction,
    null,
  );

  return (
    <section className="space-y-3" data-testid="reviewer-award">
      <header className="space-y-1">
        <h2 className="text-base font-semibold">Reconhecimento do comitê</h2>
        <p className="text-xs text-muted-foreground">
          Quem mais concluiu pareceres neste evento. Piso aplicado:{' '}
          <strong className="font-medium text-foreground">{minReviews} parecer(es)</strong>
          {cardNames.length > 0
            ? ` · carta(s) do gatilho: ${cardNames.join(', ')}`
            : ' · nenhuma carta com o gatilho REVIEWER_TOP está ativa neste evento'}
          .
        </p>
      </header>

      {ranking.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="reviewer-ranking-empty">
          Nenhum parecer concluído neste evento ainda.
        </p>
      ) : (
        <ol className="space-y-1" data-testid="reviewer-ranking">
          {ranking.slice(0, 10).map((row, index) => (
            <li
              key={row.reviewerId}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="code-data text-muted-foreground">{index + 1}º</span>
                <span className="truncate">{row.reviewerName}</span>
              </span>
              <span className="code-data text-muted-foreground">
                {row.completedReviews} parecer(es)
              </span>
            </li>
          ))}
        </ol>
      )}

      {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}

      {canAward ? (
        <form action={action}>
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />
          <input type="hidden" name="top" value="1" />
          <SubmitButton disabled={ranking.length === 0 || cardNames.length === 0} />
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">
          Você não tem permissão para conceder cartas nesta instituição.
        </p>
      )}

      {state ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          data-testid="reviewer-award-feedback"
          className={`text-xs ${state.ok ? 'text-success-strong' : 'text-destructive'}`}
        >
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
