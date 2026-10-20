'use client';

import { useActionState } from 'react';
import { Save, CheckCircle2, AlertCircle } from 'lucide-react';

import {
  updateLeadStatusAction,
  type PlatformActionState,
} from '@/app/actions/platform-actions';
import {
  LEAD_STATUS_LABELS,
  type LeadStatusKey,
} from '@/domain/platform/lead-rules';

const INITIAL: PlatformActionState = { ok: false, message: '' };

interface LeadStatusFormProps {
  leadId: string;
  currentStatus: LeadStatusKey;
  currentNotes: string | null;
}

export function LeadStatusForm({
  leadId,
  currentStatus,
  currentNotes,
}: LeadStatusFormProps) {
  const [state, action, isPending] = useActionState(updateLeadStatusAction, INITIAL);

  return (
    <form action={action} className="space-y-3" data-testid={`lead-status-form-${leadId}`}>
      <input type="hidden" name="id" value={leadId} />

      <div className="space-y-1">
        <label htmlFor={`status-${leadId}`} className="text-xs font-semibold text-foreground">
          Situação do lead
        </label>
        <select
          id={`status-${leadId}`}
          name="status"
          defaultValue={currentStatus}
          className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary focus:outline-hidden"
          data-testid={`lead-status-select-${leadId}`}
        >
          {(Object.keys(LEAD_STATUS_LABELS) as LeadStatusKey[]).map((st) => (
            <option key={st} value={st}>
              {LEAD_STATUS_LABELS[st]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor={`notes-${leadId}`} className="text-xs font-semibold text-foreground">
          Anotações internas da equipe
        </label>
        <textarea
          id={`notes-${leadId}`}
          name="notes"
          rows={2}
          defaultValue={currentNotes ?? ''}
          placeholder="Ex: Reunião agendada para terça às 14h com o pró-reitor..."
          className="w-full rounded-md border border-border bg-background p-2 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
          data-testid={`lead-notes-input-${leadId}`}
        />
      </div>

      <div className="flex items-center justify-between gap-2 pt-1">
        {state.message ? (
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              state.ok ? 'text-success font-medium' : 'text-destructive font-medium'
            }`}
          >
            {state.ok ? <CheckCircle2 className="size-3" /> : <AlertCircle className="size-3" />}
            {state.message}
          </span>
        ) : (
          <span />
        )}

        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          data-testid={`lead-status-submit-${leadId}`}
        >
          <Save className="size-3" aria-hidden />
          <span>{isPending ? 'Salvando…' : 'Atualizar'}</span>
        </button>
      </div>
    </form>
  );
}
