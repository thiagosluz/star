'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, Flag, Loader2 } from 'lucide-react';

import {
  PROFILE_REPORT_CATEGORIES,
  PROFILE_REPORT_CATEGORY_LABELS,
  PROFILE_REPORT_CATEGORY_MEANINGS,
  REPORT_DETAILS_MAX_LENGTH,
  isProfileReportCategory,
  type ProfileReportCategory,
} from '@/domain/profile/profile-moderation-rules';
import {
  reportPublicProfileAction,
  type ProfileReportActionState,
} from '@/app/actions/public-profile-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DENÚNCIA DO PERFIL PÚBLICO (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE O FORMULÁRIO NASCE FECHADO
 *  ─────────────────────────────────────────────────────────────────────────────
 *  Denunciar é um ato excepcional, e um formulário sempre aberto no meio de uma
 *  vitrine convida ao uso banal — o que transforma a fila de moderação em ruído.
 *  Ele abre pelo `<details>` do PRÓPRIO HTML, e não por um `useState`: o caminho
 *  continua funcionando sem JavaScript.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O QUE FOI DIGITADO SOBREVIVE À RECUSA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  O React 19 reseta o formulário depois da action — inclusive quando ela devolve
 *  ERRO (armadilha 5, a mesma do compositor do recado). A action devolve os valores
 *  enviados e eles voltam como `defaultValue`: um relato escrito com cuidado não se
 *  perde porque a categoria não foi escolhida.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A CATEGORIA MANDA NA DICA
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A dica embaixo do campo é o SIGNIFICADO da categoria escolhida — a mesma lista de
 *  `PROFILE_REPORT_CATEGORY_MEANINGS` que a tela de referência usa. O `useState`
 *  local existe só para a dica reagir à escolha; quem manda no formulário é o
 *  `<select>` com o nome do campo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ProfileReportForm({
  tenantSlug,
  username,
  displayName,
}: {
  tenantSlug: string;
  username: string;
  displayName: string;
}) {
  const [state, formAction] = useActionState<ProfileReportActionState | null, FormData>(
    reportPublicProfileAction,
    null,
  );

  const sentCategory = state?.data?.category;
  const initialCategory: ProfileReportCategory = isProfileReportCategory(sentCategory)
    ? sentCategory
    : PROFILE_REPORT_CATEGORIES[0];

  /**
   * ─── OS DOIS CAMPOS SÃO CONTROLADOS ──────────────────────────────────────────
   *
   *  O React 19 reseta o formulário depois da action — inclusive quando ela devolve
   *  ERRO (armadilha 5). Com `defaultValue`, o que volta para a tela depende do
   *  momento em que o React reaplica o atributo; com o ESTADO no comando, o valor
   *  digitado e a dica da categoria nunca divergem do que está no campo.
   *
   *  A action devolve o que foi enviado (`data.category`/`data.details`), e é isso
   *  que semeia o estado — o relato escrito com cuidado não se perde na recusa.
   */
  const [category, setCategory] = useState<ProfileReportCategory>(initialCategory);
  const sentDetails = state?.data?.details;
  const [details, setDetails] = useState(typeof sentDetails === 'string' ? sentDetails : '');

  /**
   * Depois do sucesso o formulário SAI DE CENA: o cartão de confirmação fica no lugar
   * dele. É esta troca (e não um `revalidatePath`) que confirma o que aconteceu — e
   * é por isso que a action não revalida a página (ver o comentário lá): revalidar
   * substituiria este cartão pelo estado do servidor no mesmo instante.
   */
  if (state?.ok) {
    return (
      <div
        role="status"
        data-testid="profile-report-result"
        data-ok="true"
        className="space-y-1 rounded-lg border border-success/40 bg-success-soft p-4 text-sm"
      >
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          {state.message ?? 'Denúncia registrada.'}
        </p>
        <p className="text-xs text-muted-foreground">
          A pessoa denunciada não é avisada de quem denunciou, e o relato fica registrado na trilha de
          auditoria.
        </p>
      </div>
    );
  }

  return (
    <details className="rounded-lg border border-border bg-card" data-testid="profile-report-form">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium">
        <Flag className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        Denunciar este perfil
      </summary>

      <form action={formAction} className="space-y-4 border-t border-border px-4 py-4">
        <input type="hidden" name="tenantSlug" value={tenantSlug} />
        <input type="hidden" name="username" value={username} />

        <p className="text-xs text-muted-foreground">
          A denúncia vai para a moderação da PLATAFORMA, não para a instituição: o endereço do perfil é
          o mesmo em todas as instituições, então a análise é uma só.
        </p>

        <label className="block space-y-1 text-xs font-medium">
          Motivo
          <select
            name="category"
            required
            value={category}
            onChange={(event) => {
              if (isProfileReportCategory(event.target.value)) setCategory(event.target.value);
            }}
            aria-label="Motivo da denúncia"
            data-testid="profile-report-category"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          >
            {PROFILE_REPORT_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {PROFILE_REPORT_CATEGORY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>

        <p className="text-xs text-muted-foreground">{PROFILE_REPORT_CATEGORY_MEANINGS[category]}</p>

        <label className="block space-y-1 text-xs font-medium">
          Detalhes
          <textarea
            name="details"
            rows={4}
            maxLength={REPORT_DETAILS_MAX_LENGTH}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder='Conte o que aconteceu. Obrigatório em "Outro motivo".'
            aria-label="Detalhes da denúncia"
            data-testid="profile-report-details"
            className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton />

          <span className="text-xs text-muted-foreground">
            A pessoa denunciada não é avisada de quem denunciou.
          </span>
        </div>

        {/**
         * Só a RECUSA chega aqui — o sucesso já trocou o formulário pelo cartão de
         * confirmação. O motivo fica ao lado do botão, junto do que precisa ser
         * corrigido, e o texto digitado continua no campo (armadilha 5).
         */}
        {state && !state.ok ? (
          <div
            role="alert"
            data-testid="profile-report-result"
            data-ok="false"
            className="space-y-1 rounded-lg border border-destructive/40 bg-destructive-soft p-3 text-sm"
          >
            <p className="font-medium">
              {state.message ?? `Não foi possível denunciar ${displayName}.`}
            </p>

            {state.details?.length ? (
              <ul className="space-y-0.5 text-xs">
                {state.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>
    </details>
  );
}

/**
 * O botão conhece o estado do envio por `useFormStatus` (e não por prop): um segundo
 * clique enquanto a action roda registraria uma denúncia que o serviço recusaria —
 * e a pessoa leria a recusa como falha da primeira.
 */
function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="profile-report-submit"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Flag className="size-3.5" aria-hidden />
      )}
      {pending ? 'Enviando…' : 'Enviar denúncia'}
    </button>
  );
}
