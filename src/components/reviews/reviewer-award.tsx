'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Award, Loader2 } from 'lucide-react';

import { awardTopReviewersAction } from '@/app/actions/gamification-actions';
import type { GamificationActionState } from '@/app/actions/gamification-actions';
import { MAX_REVIEWER_AWARDS, resolveReviewerAwardCount } from '@/domain/raffles/stage-rules';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  RECONHECIMENTO DO REVISOR DESTAQUE (FASE 16, item F1 · FASE 22, item G10)
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
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  QUANTOS RECONHECER (FASE 22, item G10)
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O painel premiava exatamente UMA pessoa (`top` fixo em 1): reconhecer os três
 *  primeiros exigia chamar o serviço por fora. O campo passou a aceitar N, com o teto
 *  no DOMÍNIO (`MAX_REVIEWER_AWARDS`) e a MESMA função que o servidor usa para
 *  resolver o corte (`resolveReviewerAwardCount`) dizendo, antes do clique, quantos
 *  serão premiados de fato — "pedi 5, o ranking tem 3" precisa ser uma decisão
 *  informada, não uma surpresa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export interface ReviewerRankingRow {
  reviewerId: string;
  reviewerName: string;
  completedReviews: number;
}

function SubmitButton({ disabled, label }: { disabled: boolean; label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      data-testid="award-top-reviewers"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Award className="size-4" aria-hidden />}
      {pending ? 'Concedendo…' : label}
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

  const [top, setTop] = useState(1);

  /**
   * A decisão é a MESMA do servidor: a tela antecipa o corte em vez de prometer um
   * número que a action vai reduzir. Quando o pedido excede o ranking, o aviso diz.
   */
  const decision = resolveReviewerAwardCount({ requested: top, rankedCount: ranking.length });
  const willAward = decision.ok ? decision.top : 0;
  const capped = decision.ok && decision.capped;

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
        <form action={action} className="space-y-2">
          <input type="hidden" name="tenantSlug" value={tenantSlug} />
          <input type="hidden" name="eventId" value={eventId} />

          <label className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Quantos reconhecer</span>
            <input
              type="number"
              name="top"
              min={1}
              max={MAX_REVIEWER_AWARDS}
              value={top}
              onChange={(event) => setTop(Number(event.target.value))}
              data-testid="reviewer-award-top"
              aria-label="Quantos revisores reconhecer"
              className="w-16 rounded-md border border-border bg-background px-2 py-1 text-xs"
            />
            <span className="text-muted-foreground">
              {decision.ok
                ? `serão premiados ${willAward} (do 1º ao ${willAward}º)`
                : /**
                   * A recusa é a MESMA do servidor, com a mensagem do domínio: enquanto
                   * o texto era fixo ("informe ao menos 1"), quem digitava 3 num evento
                   * sem ranking nenhum lia uma instrução sem sentido — o motivo era
                   * outro (não há ninguém com o piso de pareceres).
                   */
                  decision.message}
            </span>
          </label>

          {capped ? (
            <p className="text-xs text-warning-strong" data-testid="reviewer-award-capped">
              O ranking tem {ranking.length} revisor(es): o pedido foi ajustado para {willAward}.
            </p>
          ) : null}

          <SubmitButton
            disabled={ranking.length === 0 || cardNames.length === 0 || !decision.ok}
            label={
              willAward > 1 ? `Reconhecer os ${willAward} primeiros` : 'Reconhecer destaque'
            }
          />
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
