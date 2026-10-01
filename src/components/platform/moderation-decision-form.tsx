'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, EyeOff, Loader2, XCircle } from 'lucide-react';

import {
  DECISION_NOTE_MAX_LENGTH,
  DECISION_NOTE_MIN_LENGTH,
  PROFILE_MODERATION_ACTION_LABELS,
} from '@/domain/profile/profile-moderation-rules';
import { decideProfileReportAction } from '@/app/actions/admin-actions';
import type { AdminActionState } from '@/app/actions/admin-actions';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  DECISÃO DA FILA DE MODERAÇÃO (FASE 56 · dívida E62)
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  POR QUE DOIS BOTÕES DE ENVIO NUM FORMULÁRIO SÓ
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A nota da decisão é a MESMA para os dois desfechos, e quem decide escolhe no fim
 *  de escrever. Dois formulários exigiriam dois campos de texto (a pessoa digitaria
 *  a justificativa duas vezes, ou escolheria antes de pensar) — e, sem JavaScript,
 *  dois `<form>` dariam duas caixas iguais na tela.
 *
 *  Os dois botões são `<button type="submit" name="action" value="...">`: o valor do
 *  botão CLICADO entra no `FormData`, é HTML puro, e por isso o caminho continua
 *  funcionando com o JavaScript desligado.
 *
 *  ─────────────────────────────────────────────────────────────────────────────
 *  A NOTA É OBRIGATÓRIA NOS DOIS DESFECHOS
 *  ─────────────────────────────────────────────────────────────────────────────
 *  "Dispensada" sem justificativa é indistinguível de "ninguém olhou" — e ocultar um
 *  perfil é medida grave. O `required`/`minLength` do HTML dá a primeira barreira; a
 *  régua de verdade é do domínio (`decisionNoteProblem`), aplicada no serviço.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function ModerationDecisionForm({
  reportId,
  reportedName,
}: {
  reportId: string;
  reportedName: string;
}) {
  const [state, formAction] = useActionState<AdminActionState | null, FormData>(
    decideProfileReportAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-3" data-testid={`moderation-form-${reportId}`}>
      <input type="hidden" name="reportId" value={reportId} />

      <label className="block space-y-1 text-xs font-medium">
        Justificativa da decisão
        <textarea
          name="note"
          required
          rows={2}
          minLength={DECISION_NOTE_MIN_LENGTH}
          maxLength={DECISION_NOTE_MAX_LENGTH}
          defaultValue={typeof state?.data?.note === 'string' ? state.data.note : ''}
          placeholder="Por que esta é a decisão? Quem auditar vai ler isto."
          aria-label={`Justificativa da decisão sobre ${reportedName}`}
          data-testid={`moderation-note-${reportId}`}
          className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-normal"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <DecisionButton
          action="DISMISS"
          testId={`moderation-dismiss-${reportId}`}
          icon={<XCircle className="size-3.5" aria-hidden />}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-low disabled:opacity-60"
        />

        <DecisionButton
          action="HIDE"
          testId={`moderation-hide-${reportId}`}
          icon={<EyeOff className="size-3.5" aria-hidden />}
          className="inline-flex items-center gap-2 rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive transition hover:bg-destructive-soft disabled:opacity-60"
        />

        {/**
         * Só a RECUSA aparece em linha. O sucesso é visível na própria FILA — a
         * denúncia decidida sai dela (o cartão desaparece e os contadores mudam), e um
         * cartão de "decisão registrada" seria desmontado junto com ela de qualquer
         * forma, porque a ação revalida a página.
         */}
        {state && !state.ok ? (
          <span
            role="alert"
            data-testid={`moderation-feedback-${reportId}`}
            className="flex items-center gap-1.5 text-xs text-destructive"
          >
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {state.message}
            {state.details?.length ? (
              <span className="text-muted-foreground">({state.details.join('; ')})</span>
            ) : null}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * O botão leva o nome da AÇÃO no `value`, com o rótulo do domínio — a tela não
 * escreve a consequência por conta própria: quem decide lê a mesma frase que o
 * serviço aplica.
 */
function DecisionButton({
  action,
  testId,
  icon,
  className,
}: {
  action: 'DISMISS' | 'HIDE';
  testId: string;
  icon: React.ReactNode;
  className: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="action"
      value={action}
      disabled={pending}
      data-testid={testId}
      className={className}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {PROFILE_MODERATION_ACTION_LABELS[action]}
    </button>
  );
}
